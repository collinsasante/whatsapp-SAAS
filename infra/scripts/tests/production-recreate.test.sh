#!/usr/bin/env bash
# Tests the decisions of production-recreate.sh against a fake docker. Run: bash infra/scripts/tests/production-recreate.test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/infra"
cat > "$T/bin/docker" <<'SHIM'
#!/usr/bin/env bash
case "$1" in
  inspect)
    case "$*" in
      *Config.Image*) echo infra-backend;;
      *StartedAt*) echo "2026-10-22T18:39:38Z";;
      *.Config.Env*) printf 'A=1\nFACEBOOK_APP_ID=%s\n' "${FAKE_RUNNING_APP:-2428889007537244}";;
      *) echo ok;;
    esac;;
  exec)
    case "$*" in
      *DATABASE_URL*) echo "postgresql://u:p@postgres:5432/${FAKE_RUNNING_DB:-waplatform}";;
      *FACEBOOK_APP_ID*) echo "${FAKE_RUNNING_APP:-2428889007537244}";;
    esac;;
  compose)
    if [ "${@: -1}" = config ]; then
      echo "      DATABASE_URL: postgresql://u:p@postgres:5432/${FAKE_NEW_DB:-waplatform}"
      [ -n "${FAKE_MISSING:-}" ] && echo "level=warning msg=\"The \\\"$FAKE_MISSING\\\" variable is not set. Defaulting to a blank string.\"" >&2
    else echo " Container wa_backend Recreated"; fi;;
  logs) [ -n "${FAKE_NGINX:-}" ] && cat "$FAKE_NGINX";;
  ps) echo "wa_backend  Up 3 seconds";;
  *) exit 0;;
esac
SHIM
chmod +x "$T/bin/docker"
command -v sha256sum >/dev/null || { printf '#!/usr/bin/env bash\nshasum -a 256\n' > "$T/bin/sha256sum"; chmod +x "$T/bin/sha256sum"; }
: > "$T/infra/docker-compose.yml"
PASS=0; FAIL=0
penv() { printf 'JWT_SECRET=%s\nJWT_REFRESH_SECRET=prodrefresh0123456789abcdef0123456789\nFACEBOOK_APP_ID=%s\nWHATSAPP_APP_SECRET=%s\n' "${1-prodjwtsecret0123456789abcdef0123456789}" "${2:-2428889007537244}" "${3:-}" > "$T/infra/.env"; }
senv() { printf 'JWT_SECRET=stagingjwtsecret0123456789abcdef0123456789\nJWT_REFRESH_SECRET=stagingrefresh0123456789abcdef0123456789\n' > "$T/infra/.env.staging"; }
nginx() { : > "$T/nginx.log"; for code in "$@"; do echo "1.1.1.1 - - [22/Oct/2026:18:40:00 +0000] \"POST /api/v1/webhook/whatsapp/abc-123 HTTP/1.1\" $code 2 \"-\" \"x\"" >> "$T/nginx.log"; done; export FAKE_NGINX="$T/nginx.log"; }
run() { PATH="$T/bin:$PATH" INFRA_DIR="$T/infra" SNAPSHOT_DIR="$T/snap" SETTLE_SECONDS=0 PROD_HEALTH_URL="http://127.0.0.1:9/" bash "$HERE/production-recreate.sh" "$@" 2>&1; }
expect() { if printf '%s' "$3" | grep -qE "$2"; then PASS=$((PASS+1)); echo "ok    $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1"; fi; }
senv
penv; expect "passes with safe settings" "all checks passed" "$(run check)"
penv; expect "check mode changes nothing" "check only: nothing was changed" "$(run check)"
penv "" ; expect "refuses an empty JWT secret" "ABORT: JWT_SECRET is empty" "$(run check)"
penv changeme; expect "refuses the placeholder JWT secret" "ABORT: JWT_SECRET is still the placeholder" "$(run check)"
penv stagingjwtsecret0123456789abcdef0123456789; expect "refuses a JWT secret shared with staging" "ABORT: JWT_SECRET is identical" "$(run check)"
penv "" "" "somesecret"; sed -i.bak 's/^JWT_SECRET=$/JWT_SECRET=prodjwtsecret0123456789abcdef0123456789/' "$T/infra/.env"
expect "refuses a global WhatsApp app secret" "ABORT: WHATSAPP_APP_SECRET is set" "$(run check)"
expect "allows it only with an explicit override" "all checks passed" "$(ALLOW_WHATSAPP_APP_SECRET=yes run check)"
penv; expect "refuses when the running database is a staging one" "ABORT: the running database" "$(FAKE_RUNNING_DB=waplatform_staging run check)"
penv; expect "refuses when the database would change" "ABORT: .*database would change" "$(FAKE_NEW_DB=other run check)"
penv; expect "refuses an unset setting and names it" "ABORT: .*REDIS_PASSWORD" "$(FAKE_MISSING=REDIS_PASSWORD run check)"
penv "" 1281307854067000; sed -i.bak 's/^JWT_SECRET=$/JWT_SECRET=prodjwtsecret0123456789abcdef0123456789/' "$T/infra/.env"
expect "announces a Meta app change" "NOTE: +the Meta app will change" "$(run check)"
penv; expect "apply needs explicit confirmation" "ABORT: this changes PRODUCTION" "$(run apply)"
penv; nginx 200 200 200; out=$(CONFIRM_PRODUCTION=yes run apply backend); expect "apply with accepted webhooks reports OK" "OK: incoming webhooks are being accepted" "$out"
penv; nginx 200 400 400; out=$(CONFIRM_PRODUCTION=yes run apply backend); expect "apply raises the alarm when webhooks are rejected" "PROBLEM: webhooks are being rejected" "$out"
penv; nginx; out=$(CONFIRM_PRODUCTION=yes run apply backend); expect "apply says so when no webhook has arrived" "NOTE: no webhook has arrived yet" "$out"
nginx 200 200; run webhooks >/dev/null; expect "webhooks mode returns 0 when all accepted" "^0$" "$(PATH="$T/bin:$PATH" INFRA_DIR="$T/infra" bash "$HERE/production-recreate.sh" webhooks >/dev/null 2>&1; echo $?)"
nginx 200 400; expect "webhooks mode returns 1 when some are rejected" "^1$" "$(PATH="$T/bin:$PATH" INFRA_DIR="$T/infra" bash "$HERE/production-recreate.sh" webhooks >/dev/null 2>&1; echo $?)"
echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
