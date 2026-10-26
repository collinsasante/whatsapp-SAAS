#!/usr/bin/env bash
# Tests the decisions of staging-recreate.sh against a fake docker. Run: bash infra/scripts/tests/staging-recreate.test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/infra"
cat > "$T/bin/docker" <<'SHIM'
#!/usr/bin/env bash
case "$1" in
  inspect) case "$*" in *compose.project*) echo verzchat-staging;; *Config.Image*) echo infra-backend;; *.Config.Env*) printf 'A=1\n';; *) echo ok;; esac;;
  exec) case "$*" in *DATABASE_URL*) echo "postgresql://u:p@postgres:5432/waplatform_staging";; esac;;
  compose)
    if [ "${@: -1}" = config ]; then
      echo "      DATABASE_URL: postgresql://u:p@postgres:5432/${FAKE_DB:-waplatform_staging}"
      [ -n "${FAKE_MISSING:-}" ] && echo "level=warning msg=\"The \\\"$FAKE_MISSING\\\" variable is not set. Defaulting to a blank string.\"" >&2
    else echo " Container wa_staging_backend Recreated"; fi;;
  ps) echo "wa_staging_backend  Up 3 seconds";;
  *) exit 0;;
esac
SHIM
chmod +x "$T/bin/docker"
command -v sha256sum >/dev/null || { printf '#!/usr/bin/env bash\nshasum -a 256\n' > "$T/bin/sha256sum"; chmod +x "$T/bin/sha256sum"; }
: > "$T/infra/docker-compose.staging.yml"
PASS=0; FAIL=0
prod() { printf 'JWT_SECRET=prodjwtsecret0123456789abcdef0123456789\nJWT_REFRESH_SECRET=prodrefresh0123456789abcdef0123456789\nPLATFORM_ADMIN_SETUP_SECRET=prodsetup\n' > "$T/infra/.env"; }
stg() { printf 'JWT_SECRET=%s\nJWT_REFRESH_SECRET=stagingrefresh0123456789abcdef0123456789\nPLATFORM_ADMIN_SETUP_SECRET=stgsetup\nPAYSTACK_SECRET_KEY=%s\n' "${1:-stagingjwtsecret0123456789abcdef0123456789}" "${2:-sk_test_abc}" > "$T/infra/.env.staging"; }
run() { PATH="$T/bin:$PATH" INFRA_DIR="$T/infra" SNAPSHOT_DIR="$T/snap" bash "$HERE/staging-recreate.sh" "$@" 2>&1; }
expect() { # name, pattern, output
  if printf '%s' "$3" | grep -qE "$2"; then PASS=$((PASS+1)); echo "ok    $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1"; fi
}
prod
rm -f "$T/infra/.env.staging"; expect "refuses without a staging settings file" "ABORT: .*does not exist" "$(run check)"
stg prodjwtsecret0123456789abcdef0123456789; expect "refuses a JWT secret shared with production" "ABORT: JWT_SECRET is identical" "$(run check)"
stg short; expect "refuses a short JWT secret" "ABORT: JWT_SECRET .* shorter than 32" "$(run check)"
stg "" sk_live_zzz; expect "refuses a live payment key" "ABORT: PAYSTACK_SECRET_KEY .* LIVE key" "$(run check)"
stg; expect "refuses an unset setting and names it" "ABORT: .*REDIS_PASSWORD" "$(FAKE_MISSING=REDIS_PASSWORD run check)"
stg; expect "refuses a non-staging database" "ABORT: .*not a staging database" "$(FAKE_DB=waplatform run check)"
stg; out=$(run check); expect "passes with separate secrets" "all checks passed" "$out"; expect "check mode changes nothing" "check only: nothing was changed" "$out"
stg; out=$(run apply backend); expect "refuses unversioned apply" "apply is disabled; use staging-release-deploy.sh" "$out"
echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
