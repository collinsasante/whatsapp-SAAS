#!/usr/bin/env bash
# Tests the decisions of staging-ai-preflight.sh against fake docker, curl, ss and id. Run: bash infra/scripts/tests/staging-ai-preflight.test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/repo/infra"
git -C "$T/repo" init -q
cat > "$T/bin/docker" <<'SHIM'
#!/usr/bin/env bash
all="$*"
case "$1" in
  inspect)
    case "$all" in
      *compose.project*) echo "${FAKE_PROJECT:-verzchat-staging}";;
      *State.Running*) echo "${FAKE_RUNNING:-true}";;
      *RestartCount*) echo "${FAKE_RESTARTS:-0}";;
      *State.Health*) echo healthy;;
      *wa_staging_backend*Config.Env*|*Config.Env*wa_staging_backend*) printf 'MINIO_ACCESS_KEY=%s\n' "${FAKE_BACKEND_KEY:-stagingkey}";;
      *wa_staging_minio*Config.Env*|*Config.Env*wa_staging_minio*) printf 'MINIO_ROOT_USER=%s\n' "${FAKE_MINIO_USER:-stagingkey}";;
      *) echo ok;;
    esac;;
  exec)
    case "$all" in
      *printenv\ POSTGRES_DB*) echo "${FAKE_DB:-waplatform_staging}";;
      *wa_staging_nginx\ grep*) [ -z "${FAKE_NGINX_BAD:-}" ];;
      *psql*) echo "responder.system | 1.1.0 | ACTIVE";;
      *node\ -*) cat >/dev/null; echo "RESULT ${FAKE_MINIO:-matched}";;
      *) exit 0;;
    esac;;
  logs) printf '%s' "${FAKE_LOGS:-}";;
  port) printf '%s' "${FAKE_PORTS:-}";;
  *) exit 0;;
esac
SHIM
cat > "$T/bin/curl" <<'SHIM'
#!/usr/bin/env bash
case "$*" in *test-chat/usage*) echo "${FAKE_USAGE_CODE:-401}";; *) echo "${FAKE_HEALTH_CODE:-200}";; esac
SHIM
cat > "$T/bin/ss" <<'SHIM'
#!/usr/bin/env bash
[ -n "${FAKE_LISTEN:-}" ] && echo "LISTEN 0 4096 0.0.0.0:9002 0.0.0.0:*"; exit 0
SHIM
cat > "$T/bin/id" <<'SHIM'
#!/usr/bin/env bash
echo "${FAKE_UID:-0}"
SHIM
chmod +x "$T/bin/"*
PASS=0; FAIL=0
stg()  { printf 'POSTGRES_PASSWORD=a\nREDIS_PASSWORD=b\nJWT_SECRET=stg-jwt\nJWT_REFRESH_SECRET=stg-refresh\nMINIO_ACCESS_KEY=k\nMINIO_SECRET_KEY=s\nDEEPSEEK_API_KEY=%s\n' "${1:-staging-model-key}" > "$T/repo/infra/.env.staging"; }
prod() { printf 'JWT_SECRET=prod-jwt\nJWT_REFRESH_SECRET=prod-refresh\nDEEPSEEK_API_KEY=%s\n' "${1:-production-model-key}" > "$T/repo/infra/.env"; }
run() { (cd "$T/repo" && PATH="$T/bin:$PATH" bash "$HERE/staging-ai-preflight.sh" "$@" 2>&1; echo "exit=$?"); }
expect() { if printf '%s' "$3" | grep -qE "$2"; then PASS=$((PASS+1)); echo "ok    $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1"; fi; }
expect_not() { if printf '%s' "$3" | grep -qE "$2"; then FAIL=$((FAIL+1)); echo "FAIL  $1"; else PASS=$((PASS+1)); echo "ok    $1"; fi; }

stg; prod
out=$(run); expect "a healthy, separate staging passes" "STAGING AI PREFLIGHT: OK" "$out"; expect "exit code 0 when nothing failed" "exit=0" "$out"
expect "the MinIO round trip is reported" "PASS  uploaded, read back and removed" "$out"
expect_not "no secret value is ever printed" "staging-model-key|production-model-key|stg-jwt|prod-jwt" "$out"

out=$(FAKE_PROJECT=infra run); expect "stops when a container is in another project" "FAIL  .*is in project 'infra'" "$out"; expect "and exits non-zero without running further checks" "exit=1" "$out"; expect_not "...checking nothing else" "== 2\. Services" "$out"
out=$(FAKE_DB=waplatform run); expect "stops on a non-staging database name" "FAIL  database 'waplatform' does not end in _staging" "$out"
out=$(FAKE_NGINX_BAD=1 run); expect "stops when nginx does not name staging.verzchat.com" "FAIL  nginx does not name staging.verzchat.com" "$out"
out=$(FAKE_UID=1000 run); expect "stops when not root" "FAIL  not root" "$out"; expect "every stop says so and checks nothing more" "STOP: this does not look like the staging host" "$out"
out=$(FAKE_RUNNING=false run); expect "stops when a container is not running" "FAIL  .* is not running" "$out"

stg same-key; prod same-key
out=$(run); expect "fails when the model key is shared with production" "FAIL  DEEPSEEK_API_KEY is the SAME" "$out"; expect "and is NOT READY" "NOT READY" "$out"; expect_not "without printing the key" "same-key" "$out"
stg; prod
out=$(FAKE_MINIO_USER=minioadmin FAKE_BACKEND_KEY=stagingkey run); expect "fails when the backend and MinIO keys differ" "FAIL  the backend's MinIO key does NOT match" "$out"; expect "and flags the default login" "FAIL  MinIO is using the built-in default login" "$out"
out=$(FAKE_PORTS="9000/tcp -> 0.0.0.0:9002" run); expect "fails when staging MinIO publishes a host port" "FAIL  staging MinIO publishes host ports" "$out"
out=$(FAKE_LISTEN=1 run); expect "fails when something listens on 9002" "FAIL  something listens on 9002" "$out"
out=$(FAKE_HEALTH_CODE=502 run); expect "fails when the ingress is unhealthy" "FAIL  ingress health returned 502" "$out"
out=$(FAKE_USAGE_CODE=200 run); expect "fails when the usage endpoint answers without a token" "FAIL  AI usage endpoint returned 200" "$out"
out=$(FAKE_RESTARTS=9 run); expect "fails on a crash-looping service" "FAIL  wa_staging_backend has restarted 9 times" "$out"
out=$(FAKE_LOGS="Nest can't resolve dependencies" run); expect "fails on a dependency-injection error in the log" "FAIL  .*dependency-injection errors" "$out"
for r in mismatch bucket-missing error-InvalidAccessKeyId; do out=$(FAKE_MINIO=$r run); expect "fails the round trip result '$r'" "FAIL  (MinIO round trip did not succeed|the staging bucket does not exist)" "$out"; done
out=$(run --no-minio-test); expect "the round trip can be skipped, with a warning" "WARN  MinIO round trip skipped" "$out"
rm -f "$T/repo/infra/.env.staging"; out=$(run); expect "fails when the staging settings file is missing" "FAIL  staging settings file .* is missing" "$out"
stg; rm -f "$T/repo/infra/.env"; out=$(run); expect "only warns when the production file is absent (the comparison is skipped)" "WARN  production settings file not found" "$out"
out=$(run --bogus); expect "rejects an unknown argument" "unknown argument: --bogus" "$out"
echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
