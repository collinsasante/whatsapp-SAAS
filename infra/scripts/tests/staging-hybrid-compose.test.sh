#!/usr/bin/env bash
# Staging keeps the custom pgvector PostgreSQL image and the hybrid-RAG model mounts through a release, and a release can never recreate
# the database. Static checks, Compose-rendered checks (when docker-compose exists), checks of the deploy script's order, and behaviour
# tests of every guard against a fake `docker`. Nothing real is touched. Run: bash infra/scripts/tests/staging-hybrid-compose.test.sh
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
STAGING="$ROOT/infra/docker-compose.staging.yml"; PROD="$ROOT/infra/docker-compose.yml"
DEPLOY="$ROOT/infra/scripts/staging-release-deploy.sh"; LIB="$ROOT/infra/scripts/lib/staging-hybrid-guard.sh"
LOADER="$ROOT/apps/backend/src/knowledge-base/rag/local-minilm/minilm-loader.ts"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok    $1"; }
no() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }
block() { awk -v svc="  $2:" '$0 == svc {on=1; next} on && /^  [A-Za-z0-9_-]+:/ {exit} on {print}' "$1"; }

# ---- 1. staging Compose: the database image ------------------------------------------------------------------------------------------
PGB=$(block "$STAGING" postgres)
check "staging postgres uses the custom pgvector image, pinned to a minor version" 'grep -Eq "^    image: verzchat-staging/postgres-pgvector:16\.[0-9]+-0\.[0-9]+\.[0-9]+$" <<<"$PGB"'
check "staging postgres is never a stock image" '! grep -Eq "^    image: (docker.io/library/)?postgres[:@]" <<<"$PGB"'
check "staging postgres has a build stanza from infra/postgres (reproducible, never run by a release)" 'grep -q "context: ./postgres" <<<"$PGB" && grep -q "PG_IMAGE: postgres:16" <<<"$PGB" && grep -q "PGVECTOR_VERSION: v0.8" <<<"$PGB"'
check "the build base matches the image's server minor version" '[ "$(sed -nE "s/.*image: verzchat-staging\/postgres-pgvector:(16\.[0-9]+)-.*/\1/p" <<<"$PGB")" = "$(sed -nE "s/.*PG_IMAGE: postgres:(16\.[0-9]+)-alpine.*/\1/p" <<<"$PGB")" ]'
check "the pgvector version in the tag matches the build argument" '[ "$(sed -nE "s/.*postgres-pgvector:16\.[0-9]+-([0-9.]+)$/\1/p" <<<"$PGB")" = "$(sed -nE "s/.*PGVECTOR_VERSION: v([0-9.]+).*/\1/p" <<<"$PGB")" ]'
check "the Dockerfile accepts exactly those build arguments" 'grep -q "^ARG PG_IMAGE" "$ROOT/infra/postgres/Dockerfile" && grep -q "^ARG PGVECTOR_VERSION" "$ROOT/infra/postgres/Dockerfile"'
check "the database keeps its named data volume (not recreated empty)" 'grep -q "postgres_staging_data:/var/lib/postgresql/data" <<<"$PGB"'
check "the database publishes no host port" '! grep -q "^    ports:" <<<"$PGB"'
check "the database keeps its container name and health check" 'grep -q "container_name: wa_staging_postgres" <<<"$PGB" && grep -q "pg_isready" <<<"$PGB"'

# ---- 2. staging Compose: the backend's model mounts and RAG settings -----------------------------------------------------------------
BEB=$(block "$STAGING" backend)
check "backend mounts /opt/verz-models/all-MiniLM-L6-v2 at /models/all-MiniLM-L6-v2" 'grep -q "source: /opt/verz-models/all-MiniLM-L6-v2" <<<"$BEB" && grep -q "target: /models/all-MiniLM-L6-v2" <<<"$BEB"'
check "backend mounts /opt/verz-ort at /ort" 'grep -q "source: /opt/verz-ort$" <<<"$BEB" && grep -q "target: /ort$" <<<"$BEB"'
check "both model mounts are read-only" '[ "$(grep -c "^        read_only: true$" <<<"$BEB")" = 2 ]'
check "a missing host directory is an error, not an empty directory Docker creates" '[ "$(grep -c "^          create_host_path: false$" <<<"$BEB")" = 2 ]'
check "backend sets NODE_PATH and EMBEDDING_MODEL_DIR to the mount targets" 'grep -q "^      NODE_PATH: /ort/node_modules$" <<<"$BEB" && grep -q "^      EMBEDDING_MODEL_DIR: /models/all-MiniLM-L6-v2$" <<<"$BEB"'
check "hybrid retrieval stays OFF unless the host environment sets it (no value in git)" 'grep -q "^      RAG_HYBRID_ENABLED: \${RAG_HYBRID_ENABLED:-}$" <<<"$BEB" && grep -q "^      EMBEDDING_PROVIDER: \${EMBEDDING_PROVIDER:-}$" <<<"$BEB"'
check "no RAG switch is hard-coded on" '! grep -Eq "RAG_HYBRID_ENABLED: .?true|EMBEDDING_PROVIDER: .?local" "$STAGING"'
check "the uploads volume mount is still there" 'grep -q "uploads_staging_data:/app/uploads" <<<"$BEB"'
check "the worker does not receive the model mounts (it has no retrieval code)" '! block "$STAGING" worker | grep -Eq "verz-models|verz-ort|EMBEDDING|RAG_"'
check "no secret-like name was added by the hybrid settings" '! grep -E "RAG_|EMBEDDING|verz-models|verz-ort" "$STAGING" | grep -Eiq "KEY|SECRET|TOKEN|PASSWORD"'
check ".env.staging.example documents the two RAG settings, empty (off)" 'grep -Eq "^RAG_HYBRID_ENABLED=$" "$ROOT/infra/.env.staging.example" && grep -Eq "^EMBEDDING_PROVIDER=$" "$ROOT/infra/.env.staging.example"'

# ---- 3. production stays separate -------------------------------------------------------------------------------------------------
check "production Compose has no staging image, model mount or RAG setting" '! grep -Eq "postgres-pgvector|verz-models|verz-ort|RAG_HYBRID|EMBEDDING_" "$PROD"'
check "production postgres is unchanged (stock image)" 'grep -Eq "^    image: postgres:16-alpine$" <<<"$(block "$PROD" postgres)"'

# ---- 4. Compose renders as intended (Compose itself) ------------------------------------------------------------------------------
if command -v docker-compose >/dev/null 2>&1; then
  R=$(env -i PATH="$PATH" HOME="${TMPDIR:-/tmp}" docker-compose --env-file /dev/null -f "$STAGING" config 2>/dev/null)
  check "Compose accepts the staging file" '[ -n "$R" ]'
  check "rendered: postgres image is the pgvector image" 'awk "/^  postgres:/{f=1} /^  redis:/{f=0} f" <<<"$R" | grep -q "image: verzchat-staging/postgres-pgvector:16.15-0.8.7"'
  check "rendered: the backend has exactly two bind mounts and both are read-only" '[ "$(awk "/^  backend:/{f=1} /^  frontend:|^  nginx:|^  realtime:|^  worker:/{f=0} f" <<<"$R" | grep -c "type: bind")" = 2 ] && [ "$(awk "/^  backend:/{f=1} /^  frontend:|^  nginx:|^  realtime:|^  worker:/{f=0} f" <<<"$R" | grep -c "read_only: true")" = 2 ]'
  RF=$(env -i PATH="$PATH" HOME="${TMPDIR:-/tmp}" RAG_HYBRID_ENABLED=true EMBEDDING_PROVIDER=local-minilm docker-compose --env-file /dev/null -f "$STAGING" config 2>/dev/null)
  check "rendered: the host environment can switch hybrid on (nothing else needed in git)" 'grep -q "RAG_HYBRID_ENABLED: \"true\"" <<<"$RF" && grep -q "EMBEDDING_PROVIDER: local-minilm" <<<"$RF"'
  check "rendered: with nothing set the RAG switches are empty (off)" 'grep -Eq "RAG_HYBRID_ENABLED: \"\"" <<<"$R"'
else echo "skip  rendered checks: docker-compose is not installed"; fi

# ---- 5. the deploy script ---------------------------------------------------------------------------------------------------------
check "every 'up -d' in the deploy script uses --no-deps" '[ "$(grep -c "up -d" "$DEPLOY")" -ge 2 ] && [ "$(grep "up -d" "$DEPLOY" | grep -vc -- "--no-deps")" = 0 ]'
check "the deploy script builds only the five application services (never postgres)" 'grep -q "^SERVICES=(backend worker realtime whatsapp-web frontend)$" "$DEPLOY" && grep -q "build \"\${SERVICES\[@\]}\"" "$DEPLOY"'
check "the deploy script never runs down, volume removal, prune or container removal" '! grep -vE "^\s*#" "$DEPLOY" | grep -Eq "compose[^|]* down|volume (rm|prune)|system prune|image prune|docker rm |docker rmi|--volumes"'
check "the deploy script sources the hybrid guard" 'grep -q "lib/staging-hybrid-guard.sh" "$DEPLOY"'
L_GUARD=$(grep -n "staging_check_declared_postgres_image" "$DEPLOY" | head -1 | cut -d: -f1); L_STOP=$(grep -n "stop --timeout" "$DEPLOY" | head -1 | cut -d: -f1); L_MIG=$(grep -n "prisma migrate deploy" "$DEPLOY" | head -1 | cut -d: -f1); L_UP=$(grep -n "up -d --no-build --no-deps" "$DEPLOY" | tail -1 | cut -d: -f1)
check "the safeguards run BEFORE any service is stopped or migrated" '[ -n "$L_GUARD" ] && [ "$L_GUARD" -lt "$L_STOP" ] && [ "$L_GUARD" -lt "$L_MIG" ]'
check "the safeguard block checks: declared image, running image, vector available, model files" 'for f in staging_check_declared_postgres_image staging_check_running_postgres_image staging_check_vector_available staging_check_hybrid_assets; do grep -q "$f" "$DEPLOY" || exit 1; done'
check "after the rollout the script verifies the database container is unchanged and the mounts are read-only" 'grep -q "staging_check_postgres_unchanged" "$DEPLOY" && grep -q "staging_check_backend_mounts" "$DEPLOY" && [ "$(grep -c staging_check_postgres_unchanged "$DEPLOY")" -ge 2 ]'
check "rollback also checks the database container is unchanged" 'awk "/MODE\" == \"rollback\"/{f=1} /^\\[\\[ \"\\\$MODE\" == \"deploy\"/{f=0} f" "$DEPLOY" | grep -q staging_check_postgres_unchanged'

# ---- 6. the pinned model hashes cannot drift from the loader ---------------------------------------------------------------------
# shellcheck disable=SC1090
source "$LIB"
check "the guard's tokenizer hash equals the loader's pinned hash" 'grep -q "$STAGING_TOKENIZER_SHA256" "$LOADER"'
check "the guard's model hash equals the loader's pinned hash" 'grep -q "$STAGING_MODEL_SHA256" "$LOADER"'
check "the guard's mount targets equal the Compose mount targets" 'grep -q "target: $STAGING_MODEL_MOUNT_TARGET" "$STAGING" && grep -q "target: $STAGING_ORT_MOUNT_TARGET\$" "$STAGING" && grep -q "source: $STAGING_MODEL_HOST_DIR" "$STAGING" && grep -q "source: $STAGING_ORT_HOST_DIR\$" "$STAGING"'
check "the guard's postgres prefix equals the Compose image's repository" 'grep -q "image: $STAGING_POSTGRES_IMAGE_PREFIX" "$STAGING"'
check "the pinned hashes are real hashes of the right length" '[[ "$STAGING_TOKENIZER_SHA256" =~ ^[0-9a-f]{64}$ && "$STAGING_MODEL_SHA256" =~ ^[0-9a-f]{64}$ ]]'

# ---- 7. behaviour of every guard (fake docker; nothing real) --------------------------------------------------------------------
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
cat > "$T/bin/docker" <<'SH'
#!/bin/sh
case "$*" in
  *"{{.Config.Image}}"*wa_staging_postgres*) printf '%s\n' "$FAKE_PG_IMAGE" ;;
  *"{{.Id}}"*wa_staging_postgres*) [ -n "$FAKE_PG_ID" ] && printf '%s\n' "$FAKE_PG_ID" || exit 1 ;;
  *"{{range .Mounts}}"*wa_staging_backend*) printf '%b' "$FAKE_MOUNTS" ;;
  *psql*) printf '%s\n' "$FAKE_VECTOR_COUNT" ;;
  *) exit 1 ;;
esac
SH
chmod +x "$T/bin/docker"; export PATH="$T/bin:$PATH"
PGIMG="verzchat-staging/postgres-pgvector:16.15-0.8.7"

printf 'services:\n  postgres:\n    image: %s\n    container_name: x\n  redis:\n    image: redis:7\n' "$PGIMG" > "$T/good.yml"
printf 'services:\n  postgres:\n    image: postgres:16-alpine\n    container_name: x\n' > "$T/stock.yml"
printf 'services:\n  postgres:\n    image: docker.io/library/postgres:16.15-alpine\n' > "$T/stock2.yml"
printf 'services:\n  postgres:\n    container_name: x\n' > "$T/none.yml"
printf 'services:\n  postgres:\n    image: %s   # pinned\n' "$PGIMG" > "$T/comment.yml"
check "declared image: the pgvector image is accepted" '[ "$(staging_check_declared_postgres_image "$T/good.yml")" = "$PGIMG" ]'
check "declared image: a trailing comment does not confuse the parse" '[ "$(staging_check_declared_postgres_image "$T/comment.yml")" = "$PGIMG" ]'
check "declared image: stock postgres:16-alpine is REFUSED" '! staging_check_declared_postgres_image "$T/stock.yml" >/dev/null'
check "declared image: a stock image under another spelling is REFUSED" '! staging_check_declared_postgres_image "$T/stock2.yml" >/dev/null'
check "declared image: no image line is REFUSED" '! staging_check_declared_postgres_image "$T/none.yml" >/dev/null'
check "declared image: the real staging Compose passes" 'staging_check_declared_postgres_image "$STAGING" >/dev/null'

export FAKE_PG_IMAGE="$PGIMG"
check "running image equal to the declared image is accepted" 'staging_check_running_postgres_image "$PGIMG" >/dev/null'
export FAKE_PG_IMAGE="postgres:16-alpine"
check "a running STOCK database is refused, with the procedure named" 'out=$(staging_check_running_postgres_image "$PGIMG"); [ $? -ne 0 ] && grep -q "docs/staging-release.md" <<<"$out"'
export FAKE_PG_IMAGE=""
check "an unreadable database container is refused" '! staging_check_running_postgres_image "$PGIMG" >/dev/null'

export FAKE_PG_ID="aaaa1111bbbb2222"
check "unchanged database container id is accepted" 'staging_check_postgres_unchanged aaaa1111bbbb2222 >/dev/null'
check "a recreated database container is detected" '! staging_check_postgres_unchanged cccc3333dddd4444 >/dev/null'
check "an empty 'before' id is refused (cannot prove anything)" '! staging_check_postgres_unchanged "" >/dev/null'
export FAKE_PG_ID=""
check "a vanished database container is detected" '! staging_check_postgres_unchanged aaaa1111bbbb2222 >/dev/null'

export FAKE_VECTOR_COUNT=1
check "vector available: accepted" 'staging_check_vector_available u d >/dev/null'
export FAKE_VECTOR_COUNT=0
check "vector NOT available (stock image): refused" '! staging_check_vector_available u d >/dev/null'
export FAKE_VECTOR_COUNT=""
check "vector check with no answer: refused" '! staging_check_vector_available u d >/dev/null'

mkdir -p "$T/m/onnx" "$T/o/node_modules/onnxruntime-web"; echo '{"version":"1.31.1"}' > "$T/o/node_modules/onnxruntime-web/package.json"
printf 'tokenizer-bytes' > "$T/m/tokenizer.json"; printf 'model-bytes' > "$T/m/onnx/model_quantized.onnx"
TS=$(_sha256 "$T/m/tokenizer.json"); MS=$(_sha256 "$T/m/onnx/model_quantized.onnx")
check "assets: present and matching hashes are accepted" 'staging_check_hybrid_assets "$T/m" "$T/o" "$TS" "$MS" >/dev/null'
check "assets: a wrong tokenizer hash is refused" '! staging_check_hybrid_assets "$T/m" "$T/o" "$MS" "$MS" >/dev/null'
check "assets: a wrong model hash is refused" '! staging_check_hybrid_assets "$T/m" "$T/o" "$TS" "$TS" >/dev/null'
check "assets: the real pinned hashes refuse arbitrary files" '! staging_check_hybrid_assets "$T/m" "$T/o" >/dev/null'
mv "$T/m/tokenizer.json" "$T/m/tokenizer.bak"
check "assets: a missing tokenizer is refused" '! staging_check_hybrid_assets "$T/m" "$T/o" "$TS" "$MS" >/dev/null'
mv "$T/m/tokenizer.bak" "$T/m/tokenizer.json"; mv "$T/m/onnx/model_quantized.onnx" "$T/m/onnx/model.bak"
check "assets: a missing model is refused" '! staging_check_hybrid_assets "$T/m" "$T/o" "$TS" "$MS" >/dev/null'
mv "$T/m/onnx/model.bak" "$T/m/onnx/model_quantized.onnx"; mv "$T/o/node_modules" "$T/o/nm.bak"
check "assets: a missing ONNX runtime is refused" '! staging_check_hybrid_assets "$T/m" "$T/o" "$TS" "$MS" >/dev/null'
check "assets: a missing host directory is refused (and not created)" '! staging_check_hybrid_assets "$T/nope" "$T/o" "$TS" "$MS" >/dev/null && [ ! -e "$T/nope" ]'

export FAKE_MOUNTS='/models/all-MiniLM-L6-v2 ro\n/ort ro\n/app/uploads rw\n'
check "mounts: both present and read-only is accepted" 'staging_check_backend_mounts >/dev/null'
export FAKE_MOUNTS='/models/all-MiniLM-L6-v2 ro\n/ort rw\n'
check "mounts: a read-WRITE runtime mount is refused" '! staging_check_backend_mounts >/dev/null'
export FAKE_MOUNTS='/models/all-MiniLM-L6-v2 rw\n/ort ro\n'
check "mounts: a read-WRITE model mount is refused" '! staging_check_backend_mounts >/dev/null'
export FAKE_MOUNTS='/ort ro\n'
check "mounts: a missing model mount is refused" '! staging_check_backend_mounts >/dev/null'
export FAKE_MOUNTS=''
check "mounts: no mounts at all is refused" '! staging_check_backend_mounts >/dev/null'

echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
