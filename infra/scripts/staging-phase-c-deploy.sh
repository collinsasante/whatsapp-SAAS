#!/usr/bin/env bash
# Staging only (containers wa_staging_*, compose project verzchat-staging). Prints no secrets.
#   deploy:   staging-phase-c-deploy.sh deploy <BRANCH> <40-char SHA>
#   rollback: staging-phase-c-deploy.sh rollback <SNAPSHOT_DIR>
#
# Differs from the phase A script in one important way: the backend and WhatsApp Web now import NEW functions from
# @whatsapp-platform/shared-utils, and that package lives inside each container's node_modules, so copying only
# dist/ would leave the old package in place and crash on the first message. The shared packages are copied in too,
# verified to export the new functions BEFORE anything restarts, and restored on rollback.
set -u
MODE=${1:-}
fail() { echo "ABORT: $*"; exit 1; }
CODE_SERVICES="backend whatsapp_web"   # worker is unchanged in this release
SHARED="shared-utils shared-types"
COMPOSE="docker compose -p verzchat-staging -f /root/release-src/infra/docker-compose.staging.yml"

pkg_dir() {  # directory of a workspace package inside a container
  docker exec "wa_staging_$1" node -e "console.log(require('path').dirname(require.resolve('@whatsapp-platform/$2/package.json')))" 2>/dev/null
}
app_name() { [ "$1" = whatsapp_web ] && echo whatsapp-web || echo "$1"; }
healthy() {  # $1=service: running, no restarts, no fatal in recent logs
  local c=wa_staging_$1
  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = "true" ] || return 1
  [ "$(docker inspect -f '{{.RestartCount}}' "$c")" = "0" ] || return 1
  ! docker logs --since 25s "$c" 2>&1 | grep -qiE "fatal|unhandled|ECONNREFUSED|PrismaClientInitializationError|Cannot find module|is not a function"
}
verify_shared() {  # the new functions must exist in the container's copy of the package
  docker exec "wa_staging_$1" node -e "const u=require('@whatsapp-platform/shared-utils');for(const f of ['classifyJid','usableContactName','isPlausiblePhoneDigits','normalizePhone']){if(typeof u[f]!=='function'){console.error('missing '+f);process.exit(1)}}" >/dev/null 2>&1
}

restore_all() {  # $1 = snapshot dir
  local D=$1
  for s in $CODE_SERVICES; do
    local c=wa_staging_$s
    [ -d "$D/dist-$s" ] && docker cp "$D/dist-$s/." "$c:/app/dist/" >/dev/null
    for p in $SHARED; do
      local dir; dir=$(pkg_dir "$s" "$p"); [ -n "$dir" ] && [ -d "$D/$p-$s" ] && docker cp "$D/$p-$s/." "$c:$dir/" >/dev/null
    done
    docker restart "$c" >/dev/null
  done
  local name; name=$(docker inspect -f '{{.Config.Image}}' wa_staging_frontend)
  docker tag "wa-staging-backup/frontend:$(cat "$D/TAG")" "$name" && (cd /root/release-src/infra 2>/dev/null || cd /root; $COMPOSE up -d --no-deps --no-build --force-recreate frontend 2>&1 | grep -v WARN)
  sleep 25
  for s in backend whatsapp_web frontend; do healthy "$s" && echo "healthy: $s" || echo "NOT HEALTHY: $s"; done
}

if [ "$MODE" = "rollback" ]; then
  D=${2:-}; [ -d "$D" ] && [ -s "$D/TAG" ] || fail "snapshot dir missing: $D"
  echo "== ROLLBACK to $D"; restore_all "$D"; exit 0
fi
BRANCH=${2:-}; SHA=${3:-}
[ "$MODE" = "deploy" ] && [ -n "$BRANCH" ] && [ ${#SHA} -eq 40 ] || fail "usage: deploy <BRANCH> <40-char SHA>"

echo "== 1. Staging guard"
for s in backend whatsapp_web frontend postgres; do
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' wa_staging_$s)" = "verzchat-staging" ] || fail "wa_staging_$s not in verzchat-staging"
done

echo "== 2. Snapshot the CURRENT staging state (images, code, shared packages, database)"
TS=$(date +%Y%m%d-%H%M%S); D=/root/staging-release-backups/phase-c-$TS
mkdir -p "$D" && chmod 700 "$D" || fail "cannot create $D"
echo "$TS" > "$D/TAG"
for s in backend whatsapp_web frontend; do
  name=$(docker inspect -f '{{.Config.Image}}' "wa_staging_$s") || fail "inspect $s"
  docker tag "$name" "wa-staging-backup/${s}:$TS" || fail "tag $s"
done
for s in $CODE_SERVICES; do
  docker cp "wa_staging_$s:/app/dist" "$D/dist-$s" >/dev/null || fail "copy dist from $s"
  [ -n "$(ls -A "$D/dist-$s")" ] || fail "dist-$s empty"
  for p in $SHARED; do
    dir=$(pkg_dir "$s" "$p"); [ -n "$dir" ] || fail "cannot locate $p inside $s"
    docker cp "wa_staging_$s:$dir" "$D/$p-$s" >/dev/null || fail "copy $p from $s"
    [ -n "$(ls -A "$D/$p-$s")" ] || fail "$p-$s snapshot empty"
  done
done
DBNAME=$(docker exec wa_staging_backend printenv DATABASE_URL | sed -E 's#.*/([^/?]+).*#\1#'); case "$DBNAME" in *_staging) ;; *) fail "database '$DBNAME' does not look like staging";; esac
PGUSER_=$(docker exec wa_staging_postgres printenv POSTGRES_USER)
docker exec wa_staging_postgres pg_dump -U "$PGUSER_" -Fc "$DBNAME" > "$D/db.dump" || fail "pg_dump"
docker exec -i wa_staging_postgres pg_restore -l < "$D/db.dump" | head -3 | grep -q . || fail "db.dump not readable"
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_frontend | grep '^NEXT_PUBLIC_' > "$D/frontend-build-args.env"; chmod 600 "$D/frontend-build-args.env"
echo "snapshot OK: $D"; echo "ROLLBACK COMMAND: bash $0 rollback $D"

echo "== 3. Export the exact commit"
git -C /root/whatsapp-platform fetch -q origin "$BRANCH" || fail "fetch"
[ "$(git -C /root/whatsapp-platform rev-parse FETCH_HEAD)" = "$SHA" ] || fail "branch tip is not $SHA"
rm -rf /root/release-src; mkdir /root/release-src; git -C /root/whatsapp-platform archive "$SHA" | tar -x -C /root/release-src || fail "export"
grep -q "classifyJid" /root/release-src/packages/shared-utils/src/contact-identity.ts || fail "contact identity fix missing from export"
grep -q "VoiceNotePlayer" /root/release-src/apps/frontend/src/components/inbox/VoiceNotePlayer.tsx || fail "voice note player missing from export"
grep -q "extractInboundContent" /root/release-src/apps/whatsapp-web/src/inbound-content.ts || fail "inbound content fix missing from export"
grep -q "release-to-ai\|releaseToAi" /root/release-src/apps/backend/src/conversations/conversations.service.ts || fail "release-to-AI fix missing from export"

echo "== 4. Recover the frontend's baked build URLs"
ARGS="$D/frontend-build-args.env"
if [ ! -s "$ARGS" ]; then
  API=$(docker exec wa_staging_frontend sh -c "grep -rhoE 'https?://[^\"\\\\ ]+/api/v1' /app/apps/frontend/.next 2>/dev/null" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
  [ -n "$API" ] || fail "could not recover NEXT_PUBLIC_API_URL; refusing to build a frontend with a blank API URL"
  SENTRY=$(docker exec wa_staging_frontend sh -c "grep -rhoE 'https://[a-f0-9]+@[A-Za-z0-9.]+/[0-9]+' /app/apps/frontend/.next 2>/dev/null" | sort -u | head -1)
  { echo "NEXT_PUBLIC_API_URL=$API"; echo "NEXT_PUBLIC_SOCKET_URL=${API%/api/v1}"; echo "NEXT_PUBLIC_SENTRY_DSN=${SENTRY:-}"; echo "NEXT_PUBLIC_SHOW_DEV_TOOLS=true"; } > "$ARGS"; chmod 600 "$ARGS"
fi
grep -q '^NEXT_PUBLIC_API_URL=http' "$ARGS" || fail "frontend build args invalid"
echo "frontend will be built with: $(grep -E '^NEXT_PUBLIC_(API|SOCKET)_URL' "$ARGS" | tr '\n' ' ')"

echo "== 5. Build on the host (no schema change, no new dependencies)"
cd /root/release-src || fail cd
echo "  5a installing dependencies"; pnpm install --frozen-lockfile --ignore-scripts >/dev/null 2>&1 || fail "pnpm install"
echo "  5b prisma generate"; pnpm --filter @whatsapp-platform/backend prisma:generate >/dev/null 2>&1 || fail "prisma generate"
echo "  5c shared packages"; pnpm --filter @whatsapp-platform/shared-types --filter @whatsapp-platform/shared-utils build >/dev/null 2>&1 || fail "shared build"
node -e "const u=require('./packages/shared-utils/dist');if(typeof u.classifyJid!=='function'||typeof u.usableContactName!=='function')process.exit(1)" || fail "built shared-utils does not export the new functions"
for p in backend whatsapp-web; do echo "  5d build $p"; pnpm --filter "@whatsapp-platform/$p" build >/dev/null 2>&1 || fail "build $p"; [ -d apps/$p/dist ] || fail "no dist for $p"; done
echo "  5e frontend image (slowest, several minutes)"; docker build -q -f apps/frontend/Dockerfile $(sed 's/^/--build-arg /' "$ARGS" | tr '\n' ' ') -t wa-staging-frontend-new:$TS . >/dev/null || fail "frontend image build (nothing deployed yet)"
echo "build OK (nothing on staging has changed yet)"

rollback_now() { echo "!! $1 -> rolling back"; restore_all "$D"; exit 1; }

# Optional backend settings that the hot-swap cannot set (the container's own environment is fixed at creation).
# /root/staging-backend.env is copied to /app/.env, which the app reads for any variable the container does not define.
EXTRA=/root/staging-backend.env
MARK="# managed by staging deploy script"
if [ -f "$EXTRA" ]; then
  [ "$(head -n1 "$EXTRA")" = "$MARK" ] || fail "$EXTRA must start with the line: $MARK"
  if docker exec wa_staging_backend test -e /app/.env; then
    [ "$(docker exec wa_staging_backend head -n1 /app/.env)" = "$MARK" ] || fail "wa_staging_backend already has an /app/.env this script did not create"
  fi
fi

echo "== 6. Swap backend and WhatsApp Web (shared packages first, verified, then code, then restart)"
for s in $CODE_SERVICES; do
  c=wa_staging_$s
  for p in $SHARED; do
    dir=$(pkg_dir "$s" "$p"); [ -n "$dir" ] || rollback_now "locate $p in $s"
    docker cp "packages/$p/dist/." "$c:$dir/dist/" >/dev/null || rollback_now "copy $p into $s"
  done
  verify_shared "$s" || rollback_now "$s does not see the new shared-utils functions"
  docker cp "apps/$(app_name "$s")/dist/." "$c:/app/dist/" >/dev/null || rollback_now "copy code into $s"
  if [ "$s" = backend ] && [ -f "$EXTRA" ]; then docker cp "$EXTRA" "$c:/app/.env" >/dev/null || rollback_now "copy backend env"; fi
  docker restart "$c" >/dev/null || rollback_now "restart $s"
  sleep 25; healthy "$s" || rollback_now "$s unhealthy"; echo "healthy: $s"
done

echo "== 7. Frontend image"
name=$(docker inspect -f '{{.Config.Image}}' wa_staging_frontend); docker tag "wa-staging-frontend-new:$TS" "$name" || rollback_now "tag frontend"
(cd infra && $COMPOSE up -d --no-deps --no-build --force-recreate frontend 2>&1 | grep -v WARN)
sleep 20; healthy frontend || rollback_now "frontend unhealthy"; echo "healthy: frontend"
echo "DEPLOYED $SHA to staging."; echo "ROLLBACK COMMAND: bash $0 rollback $D"
