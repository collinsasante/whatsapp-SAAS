#!/usr/bin/env bash
# Verifies ONE committed SHA end to end on THIS machine, using disposable local Postgres and Redis only. It never contacts staging or
# production, never reads infra/.env*, and prints no secret (the only credential used is a fixed throwaway password for the disposable
# containers). Prerequisites: pnpm dependencies installed (pnpm install --frozen-lockfile), Docker (local daemon), Node 20.
#
#   VERIFY_PG_IMAGE=<postgres 16 image that includes pgvector 0.8.x> bash infra/scripts/verify-release-candidate.sh <40-char-sha>
#
# The checkout must be clean and HEAD must equal the SHA. ALLOW_DIRTY=1 lets you rehearse the script itself on a work in progress; the
# summary is then stamped "NOT A RELEASE VERIFICATION" and the exit status is non-zero.
set -u
SHA=${1:-}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: $0 <full 40-character commit SHA>" >&2; exit 2; }
ROOT=$(git rev-parse --show-toplevel) || exit 2
cd "$ROOT" || exit 2
HEAD_SHA=$(git rev-parse HEAD)
DIRTY=false
[[ "$HEAD_SHA" == "$SHA" ]] || { echo "ABORT: HEAD is $HEAD_SHA, not the requested $SHA" >&2; [[ "${ALLOW_DIRTY:-}" == 1 ]] || exit 2; DIRTY=true; }
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo "ABORT: the checkout is not clean" >&2; [[ "${ALLOW_DIRTY:-}" == 1 ]] || exit 2; DIRTY=true; }
PG_IMAGE=${VERIFY_PG_IMAGE:-pgvector/pgvector:pg16}
command -v docker >/dev/null || { echo "ABORT: docker is required" >&2; exit 2; }
[[ "$(docker context show 2>/dev/null)" != *staging* && "$(docker context show 2>/dev/null)" != *prod* ]] || { echo "ABORT: docker context looks like a server; use a local daemon" >&2; exit 2; }
[[ -z "${DOCKER_HOST:-}" || "$DOCKER_HOST" == unix://* ]] || { echo "ABORT: DOCKER_HOST points at a remote daemon" >&2; exit 2; }

OUT=$(mktemp -d "${TMPDIR:-/tmp}/verify-rc.XXXXXX"); PW=verify_pw_local; PGP=55460; RDP=16460
PG=verify-rc-pg; RD=verify-rc-redis; PIDS=()
RESULTS=(); FAILED=0
cleanup() { for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "$p" 2>/dev/null; done; docker rm -f "$PG" "$RD" >/dev/null 2>&1; }
trap cleanup EXIT
dburl() { echo "postgresql://postgres:$PW@127.0.0.1:$PGP/$1"; }

# step "<name>" <command...>: runs, records PASS/FAIL, keeps the log under $OUT, shows the last lines of a failure.
step() {
  local name=$1; shift; local log="$OUT/$(echo "$name" | tr -c 'A-Za-z0-9' '_').log"
  if "$@" >"$log" 2>&1; then RESULTS+=("PASS  $name"); else RESULTS+=("FAIL  $name   (log: $log)"); FAILED=1; tail -n 12 "$log" | sed 's/^/        /'; fi
}
skip() { RESULTS+=("SKIP  $1   ($2)"); }
jest_in() { (cd apps/backend && env "$@" npx jest 2>&1 | tee "$OUT/jest-last.txt"; exit "${PIPESTATUS[0]}"); }

echo "== candidate $SHA  (dirty=$DIRTY)   disposable image: $PG_IMAGE   logs: $OUT"

# ---- 1. provenance of the restored migration -------------------------------------------------------------------------------------
M=apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql
step "migration 20260708120000 is byte-identical to commit 5ba3e99" bash -c "cmp <(git show 5ba3e99:$M) $M"
step "migration tree: 95 folders, sorted, each with migration.sql" bash -c 'cd apps/backend/prisma/migrations && n=$(ls | grep -vc lock) && [ "$n" -ge 95 ] && ls | grep -v lock | sort -c && for d in $(ls | grep -v lock); do [ -s $d/migration.sql ] || exit 1; done'

# ---- 2. disposable infrastructure ------------------------------------------------------------------------------------------------
docker rm -f "$PG" "$RD" >/dev/null 2>&1
docker run -d --rm --name "$PG" -e POSTGRES_PASSWORD=$PW -p $PGP:5432 "$PG_IMAGE" >/dev/null && docker run -d --rm --name "$RD" -p $RDP:6379 redis:7-alpine >/dev/null || { echo "ABORT: could not start disposable containers" >&2; exit 2; }
for _ in $(seq 1 40); do docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 3
HAS_VECTOR=false; docker exec "$PG" psql -U postgres -Atc "select count(*) from pg_available_extensions where name='vector'" | grep -q '^1$' && HAS_VECTOR=true
# One database per suite: several suites TRUNCATE tables and Jest runs spec files in parallel, so they must not share a database.
for db in fresh_check upgrade_check verify_iso_test verify_media_test verify_ds_test verify_rag_test verify_boot_test; do docker exec "$PG" psql -U postgres -qc "create database $db"; done

# ---- 3. migrations ---------------------------------------------------------------------------------------------------------------
PRISMA="$ROOT/apps/backend/node_modules/.bin/prisma"
step "fresh install: prisma migrate deploy" bash -c "cd apps/backend && DATABASE_URL=$(dburl fresh_check) $PRISMA migrate deploy"
step "fresh install: migrate status is up to date" bash -c "cd apps/backend && DATABASE_URL=$(dburl fresh_check) $PRISMA migrate status | grep -q 'up to date'"
step "schema matches schema.prisma (no missing table or column)" bash -c "cd apps/backend && DATABASE_URL=$(dburl fresh_check) $PRISMA migrate diff --from-url '$(dburl fresh_check)' --to-schema-datamodel prisma/schema.prisma --script | grep -E 'CREATE TABLE|ADD COLUMN' | wc -l | grep -q '^ *0$'"
step "upgrade: first 50 migrations, seed a row, apply the rest, row survives" bash -c "
  set -e; T=\$(mktemp -d); mkdir -p \$T/prisma/migrations; cp apps/backend/prisma/schema.prisma \$T/prisma/; cp apps/backend/prisma/migrations/migration_lock.toml \$T/prisma/migrations/
  for d in \$(ls apps/backend/prisma/migrations | grep -v lock | head -50); do cp -R apps/backend/prisma/migrations/\$d \$T/prisma/migrations/; done
  DATABASE_URL=$(dburl upgrade_check) $PRISMA migrate deploy --schema \$T/prisma/schema.prisma >/dev/null
  docker exec $PG psql -U postgres -d upgrade_check -qc \"insert into tenants (id,name,webhook_verify_token,updated_at) values ('t-up','Upgrade Co','v',now())\"
  DATABASE_URL=$(dburl upgrade_check) $PRISMA migrate deploy --schema apps/backend/prisma/schema.prisma >/dev/null
  [ \"\$(docker exec $PG psql -U postgres -d upgrade_check -Atc \"select name from tenants where id='t-up'\")\" = 'Upgrade Co' ]
  [ \"\$(docker exec $PG psql -U postgres -d upgrade_check -Atc 'select count(*) from _prisma_migrations where finished_at is not null')\" = \"\$(ls apps/backend/prisma/migrations | grep -vc lock)\" ]"
step "migration gate accepts this tree against its own applied history" bash -c "
  set -e; docker exec $PG psql -U postgres -d fresh_check -At -F '|' -c 'SELECT migration_name, checksum FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' > $OUT/applied.txt
  command -v sha256sum >/dev/null || { mkdir -p $OUT/shim; printf '#!/bin/sh\nexec shasum -a 256 \"\$@\"\n' > $OUT/shim/sha256sum; chmod +x $OUT/shim/sha256sum; export PATH=$OUT/shim:\$PATH; }
  source infra/scripts/lib/staging-migration-gate.sh; check_applied_migrations apps/backend/prisma/migrations $OUT/applied.txt"

# ---- 4. backup and restore rehearsal -------------------------------------------------------------------------------------------------
if $HAS_VECTOR; then
  step "backup-restore rehearsal (dump with pgvector table, restore in a network-less container)" bash -c "
    set -e; docker exec $PG psql -U postgres -d fresh_check -qc 'create extension if not exists vector'
    docker exec $PG pg_dump -U postgres -Fc fresh_check > $OUT/fresh.dump
    RESTORE_CHECK_IMAGE=$PG_IMAGE bash infra/scripts/staging-verify-backup-restore.sh $OUT/fresh.dump"
else
  skip "backup-restore rehearsal with the vector extension" "VERIFY_PG_IMAGE has no pgvector"
fi

# ---- 5. typechecks ---------------------------------------------------------------------------------------------------------------
for app in backend frontend mobile worker realtime whatsapp-web; do step "typecheck $app" bash -c "cd apps/$app && npx tsc --noEmit"; done

# ---- 6. backend test suite, including every database-gated suite ----------------------------------------------------------------
if $HAS_VECTOR; then RAGENV="RAG_TEST_DATABASE_URL=$(dburl verify_rag_test)"; else RAGENV="RAG_TEST_DATABASE_URL="; skip "pgvector store suite" "no pgvector in VERIFY_PG_IMAGE"; fi
for db in verify_iso_test verify_media_test verify_ds_test verify_rag_test verify_boot_test; do (cd apps/backend && DATABASE_URL=$(dburl $db) "$PRISMA" migrate deploy >/dev/null 2>&1); done
step "backend jest (all suites; DB suites against disposable Postgres+Redis)" jest_in \
  "TENANT_ISOLATION_TEST_DATABASE_URL=$(dburl verify_iso_test)" "MEDIA_TEST_DATABASE_URL=$(dburl verify_media_test)" \
  "DIGITAL_SELF_TEST_DATABASE_URL=$(dburl verify_ds_test)" "DIGITAL_SELF_TEST_REDIS_URL=redis://127.0.0.1:$RDP" "$RAGENV"
JT=$(grep -E '^Tests:' "$OUT/jest-last.txt" 2>/dev/null | tail -1); JS=$(grep -E '^Test Suites:' "$OUT/jest-last.txt" 2>/dev/null | tail -1)
RESULTS+=("INFO  jest: ${JS:-no summary}  |  ${JT:-no summary}")
step "realtime tests (auth, rooms, real-socket tenant isolation)" bash -c "cd apps/realtime && npm test"
step "whatsapp-web tests" bash -c "cd apps/whatsapp-web && npm test"
skip "frontend tests" "the frontend has no test runner; typecheck only"
skip "mobile tests" "the mobile app has no test runner; typecheck only"

# ---- 7. deploy-contract tests (shell) ----------------------------------------------------------------------------------------------
for t in infra/scripts/tests/*.test.sh; do step "deploy-contract: $(basename "$t")" bash "$t"; done

# ---- 8. live boot of the built services against the restored-style database, health, graceful shutdown ------------------------------
R() { openssl rand -hex 24; }
for app in backend worker realtime whatsapp-web; do step "build $app" bash -c "cd apps/$app && $( [ $app = backend ] && echo './node_modules/.bin/nest build' || echo 'npx tsc')"; done
BOOT_DB=$(dburl verify_boot_test); IS=$(R); WK=$(R); JW=$(R); WA=$(R); EK=$(head -c 32 /dev/urandom | base64)
boot() { # name, dir, entry, port, extra env...
  local name=$1 dir=$2 entry=$3; shift 3
  ( cd "$dir" && exec env DATABASE_URL="$BOOT_DB" REDIS_HOST=127.0.0.1 REDIS_PORT=$RDP NODE_ENV=production INTERNAL_SECRET="$IS" WHATSAPP_WEB_INTERNAL_API_KEY="$WK" \
      JWT_SECRET="$JW" JWT_REFRESH_SECRET="$(R)" WHATSAPP_APP_SECRET="$WA" CREDENTIALS_ENCRYPTION_KEY="$EK" "$@" node "$entry" ) >"$OUT/boot-$name.log" 2>&1 &
  PIDS+=($!); echo $! > "$OUT/$name.pid"
}
boot realtime apps/realtime dist/index.js PORT=4466
boot backend apps/backend dist/backend/src/main.js PORT=4455 REALTIME_URL=http://127.0.0.1:4466 STORAGE_DRIVER=local LOCAL_UPLOAD_PATH="$OUT/uploads"
boot worker apps/worker dist/index.js BACKEND_URL=http://127.0.0.1:4455 REALTIME_URL=http://127.0.0.1:4466
boot whatsapp-web apps/whatsapp-web dist/index.js PORT=4477 BACKEND_INTERNAL_URL=http://127.0.0.1:4455 LOG_LEVEL=warn
sleep 35
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
step "boot: backend health 200 and readiness 200" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' localhost:4455/api/v1/health) = 200 ] && [ \$(curl -s -o /dev/null -w '%{http_code}' localhost:4455/api/v1/health/ready) = 200 ]"
step "boot: realtime health 200 and /internal/emit refuses an unauthenticated call" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' localhost:4466/health) = 200 ] && [ \$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:4466/internal/emit -H 'content-type: application/json' -d '{}') = 401 ]"
step "boot: whatsapp-web health 200 and the API refuses a call with no key" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' localhost:4477/health) = 200 ] && [ \$(curl -s -o /dev/null -w '%{http_code}' localhost:4477/sessions) = 401 ]"
step "boot: worker started all workers" grep -q 'All workers started' "$OUT/boot-worker.log"
step "boot: worker reaches the backend's internal API under /api/v1" bash -c "[ \$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:4455/api/v1/manage/settings/ai/trial-expired -H 'x-internal-secret: $IS' -H 'content-type: application/json' -d '{\"tenantId\":\"5f1c2b4a-1d6e-4f70-8a91-b2c3d4e5f6aa\"}') = 201 ]"
for n in worker whatsapp-web realtime backend; do
  pid=$(cat "$OUT/$n.pid"); kill -TERM "$pid" 2>/dev/null; for _ in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  if kill -0 "$pid" 2>/dev/null; then RESULTS+=("FAIL  graceful shutdown: $n still running 25s after SIGTERM"); FAILED=1; else RESULTS+=("PASS  graceful shutdown: $n exited after SIGTERM"); fi
done
step "boot logs: no unhandled errors, no secret values" bash -c "! grep -qiE 'unhandled' $OUT/boot-*.log && ! grep -qF -e '$IS' -e '$WK' -e '$JW' -e '$WA' $OUT/boot-*.log"

# ---- summary ---------------------------------------------------------------------------------------------------------------------
echo; echo "================ SUMMARY for $SHA ================"
printf '%s\n' "${RESULTS[@]}"
echo "logs kept in: $OUT"
if $DIRTY; then echo "NOT A RELEASE VERIFICATION: HEAD/clean checks failed or were overridden (ALLOW_DIRTY=1)."; exit 3; fi
[[ $FAILED -eq 0 ]] && echo "RESULT: ALL STEPS PASSED for the exact commit $SHA" || { echo "RESULT: FAILURES PRESENT"; exit 1; }
