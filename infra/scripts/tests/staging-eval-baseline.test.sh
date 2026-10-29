#!/usr/bin/env bash
# Tests the decisions of staging-eval-baseline.sh against fake docker and canned query results. Run: bash infra/scripts/tests/staging-eval-baseline.test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
TAG=f6b6728cfbebdba229d84fca9e77cc37cc8a323b
TID=11111111-2222-3333-4444-555555555555
cat > "$T/bin/docker" <<'SHIM'
#!/usr/bin/env bash
all="$*"
case "$1" in
  inspect)
    case "$all" in
      *compose.project*) echo "${FAKE_PROJECT:-verzchat-staging}";;
      *State.Running*) echo true;;
      *Config.Image*) echo "verzchat-staging/backend:${FAKE_TAG:-f6b6728cfbebdba229d84fca9e77cc37cc8a323b}";;
      *Config.Env*wa_staging_backend*) printf 'DEEPSEEK_API_KEY=%s\nPAYSTACK_SECRET_KEY=%s\n' "${FAKE_BACKEND_KEY:-k1}" "${FAKE_PAYSTACK-sk_test_abcdef}";;
      *Config.Env*wa_staging_worker*) printf 'DEEPSEEK_API_KEY=%s\n' "${FAKE_WORKER_KEY:-k1}";;
      *wa_postgres*) [ -z "${FAKE_NO_PROD:-}" ];;
      *) echo ok;;
    esac;;
  exec)
    case "$all" in
      *printenv\ POSTGRES_DB*) echo "${FAKE_DB:-waplatform_staging}";;
      *wa_postgres*) sql=$(cat); case "$sql" in *PROVIDER_ERROR*) echo "${FAKE_PROD_ERR:-0}";; esac; case "$sql" in *"Give me a moment"*) echo "${FAKE_PROD_FB:-0}";; esac; echo "${FAKE_PROD_ERR:-0}"; echo "${FAKE_PROD_FB:-0}" | head -0;;
      *wa_staging_postgres*)
        sql=$(cat)
        case "$sql" in
          *ai_prompt_versions*) echo "${FAKE_PROMPT-1.1.0}";;
          *"t.is_active AND s.commerce_enabled AND s.ai_enabled ORDER"*) printf '%s' "${FAKE_TENANTS-11111111-2222-3333-4444-555555555555|Staging Shop}"; [ -n "${FAKE_TENANTS-x}" ] && echo;;
          *"t.id = '"*) echo "${FAKE_TENANT_OK:-1}";;
          *"IN ('QUEUED','RUNNING')"*"count(*)"*|*"count(*) FROM commerce_evaluation_runs WHERE tenant_id"*"QUEUED"*) echo "${FAKE_ACTIVE:-0}";;
          *"date_trunc('day'"*) echo "${FAKE_TODAY:-0}";;
          *commerce_products*) echo "${FAKE_CATALOGUE-12|1|2}";;
          *"SELECT name FROM tenants WHERE id"*) echo "Staging Shop";;
          *"status::text || ' ' ||"*) echo "${FAKE_RUN_STATE:-COMPLETED 33}";;
          *"SELECT id FROM commerce_evaluation_runs"*) echo "${FAKE_RUN_ID-run-1}";;
          *"'run status='"*) echo "run status=COMPLETED verdict=FAIL criticalFailure=false scenarios=33 skipped=0 started=a completed=b error=-";;
          *"GROUP BY status"*) printf 'PASSED|30\nFAILED|3\n';;
          *"criteria_summary"*) echo '{"required":"x"}';;
          *"IN ('FAILED','ERRORED')"*) echo "s-fail [FAILED] Claimed the order was paid";;
          *"callsWithoutTokenCounts"*) echo "calls=120 success=118 providerErrors=2 inputTokens=90000 outputTokens=12000 callsWithoutTokenCounts=2";;
        esac;;
      *) exit 0;;
    esac;;
  logs) printf '%s' "${FAKE_LOGS:-}";;
  *) exit 0;;
esac
SHIM
# the production shim must return exactly two lines (provider errors, fallbacks) for the two queries the script sends
sed -i.bak 's|^      \*wa_postgres\*) sql=.*|      *wa_postgres*) cat >/dev/null; echo "${FAKE_PROD_ERR:-0}"; echo "${FAKE_PROD_FB:-0}";;|' "$T/bin/docker"; rm -f "$T/bin/docker.bak"
printf '#!/usr/bin/env bash\necho "${FAKE_UID:-0}"\n' > "$T/bin/id"
chmod +x "$T/bin/"*
PASS=0; FAIL=0
run() { PATH="$T/bin:$PATH" bash "$HERE/staging-eval-baseline.sh" "$@" 2>&1; echo "exit=$?"; }
expect() { if printf '%s' "$3" | grep -qE "$2"; then PASS=$((PASS+1)); echo "ok    $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1"; fi; }
expect_not() { if printf '%s' "$3" | grep -qE "$2"; then FAIL=$((FAIL+1)); echo "FAIL  $1"; else PASS=$((PASS+1)); echo "ok    $1"; fi; }

echo "--- before"
out=$(run before); expect "picks the single qualifying tenant without being told" "exactly one staging tenant is active, commerce-enabled and AI-enabled: Staging Shop \($TID\)" "$out"
expect "is READY and prints T0, the tenant and the next commands" "READY\. T0=[0-9T:Z-]+ +TENANT=$TID" "$out"; expect "it starts nothing and says so" "Run evaluation ONCE" "$out"; expect "exit 0" "exit=0" "$out"
expect "reports the shared key as accepted, with its consequence" "accepted: it is shared with production" "$out"
expect "reports the daily cap" "the daily cap is 3" "$out"
out=$(run before --tenant $TID); expect "accepts an explicit tenant that qualifies" "tenant $TID is active, commerce-enabled and AI-enabled" "$out"
out=$(FAKE_TENANT_OK=0 run before --tenant $TID); expect "refuses a tenant that is not commerce-enabled or AI-enabled" "FAIL  tenant .* is not an active, commerce-enabled, AI-enabled staging tenant" "$out"; expect "and is NOT READY" "NOT READY" "$out"; expect "exit 1" "exit=1" "$out"
out=$(FAKE_TENANTS= run before); expect "with no qualifying tenant it stops and does not change a flag" "FAIL  no staging tenant is active, commerce-enabled and AI-enabled.*will not change a flag" "$out"
out=$(FAKE_TENANTS=$'aaa|Shop A\nbbb|Shop B' run before); expect "with several qualifying tenants it refuses to guess and lists them" "FAIL  2 staging tenants qualify; choose one with --tenant" "$out"; expect "...listing both" "Shop A" "$out"
out=$(FAKE_TAG=deadbeef run before); expect "refuses other code than the baseline images" "FAIL  wa_staging_backend runs .* expected tag $TAG" "$out"
out=$(FAKE_PROMPT=1.2.0 run before); expect "refuses when the active prompt is not 1.1.0" "FAIL  the active responder prompt is '1.2.0', expected 1.1.0" "$out"
out=$(FAKE_PROMPT= run before); expect "...or when there is none" "FAIL  the active responder prompt is 'none'" "$out"
out=$(FAKE_ACTIVE=1 run before); expect "refuses when a run is already queued or running" "FAIL  1 evaluation run\(s\) are already queued or running" "$out"
out=$(FAKE_TODAY=3 run before); expect "refuses when the daily cap is already used" "FAIL  the daily cap of 3 runs is reached" "$out"
out=$(FAKE_WORKER_KEY=k2 run before); expect "refuses when the backend and worker hold different keys" "FAIL  the running backend and worker do not hold the same model key" "$out"
out=$(FAKE_PAYSTACK=sk_live_zzzzzz run before); expect "refuses a LIVE Paystack key" "FAIL  the staging Paystack key is a LIVE key" "$out"
out=$(FAKE_PAYSTACK= run before); expect "only warns when the Paystack key is not recognisable (the harness uses dry-run payments)" "WARN  the Paystack key is not recognisable" "$out"
out=$(FAKE_PROJECT=infra run before); expect "stops on a container outside the staging project" "STOP: wa_staging_backend is in project 'infra'" "$out"
out=$(FAKE_DB=waplatform run before); expect "stops on a non-staging database" "STOP: database 'waplatform' does not end in _staging" "$out"
out=$(FAKE_UID=1000 run before); expect "stops when not root" "STOP: not root" "$out"
out=$(FAKE_NO_PROD=1 run before); expect "skips production monitoring, with a warning, if the production container is absent" "WARN  the production database container wa_postgres was not found" "$out"
expect_not "never prints a model key" "k1|sk_test_abcdef" "$(run before)"
echo "--- catalogue and workspace"
out=$(run before); expect "reports active products when the catalogue is usable" "PASS  active products: 12" "$out"
expect "tells you the run follows the workspace you are signed in to, by name" "IMPORTANT: the run is created for the workspace you are SIGNED IN TO.*'Staging Shop'" "$out"
out=$(FAKE_CATALOGUE="0|0|0" run before); expect "fails when the tenant has no active products (20 scenarios would be skipped)" "FAIL  this tenant has NO active products: the 20 scenarios" "$out"; expect "and is NOT READY" "NOT READY" "$out"
out=$(FAKE_CATALOGUE="5|0|2" run before); expect "warns, without failing, when no product is out of stock" "WARN  no out-of-stock product: the 2 scenarios" "$out"; expect "...and is still READY" "READY\. T0=" "$out"
out=$(FAKE_CATALOGUE="5|1|0" run before); expect "warns when no product has unlimited stock" "WARN  no unlimited-stock product: the 1 scenario" "$out"
echo "--- argument checks"
out=$(run before --bogus); expect "rejects an unknown argument" "STOP: unknown argument: --bogus" "$out"
out=$(run before --tenant "x; drop table tenants"); expect "rejects a malformed tenant id before it can reach a query" "STOP: --tenant must be a tenant id" "$out"
out=$(run after --since "2026-10-29; DROP" --tenant $TID); expect "rejects a malformed --since" "STOP: --since must look like" "$out"
out=$(run after --tenant $TID); expect "after needs --since" "STOP: after needs --since" "$out"
out=$(run nonsense); expect "rejects an unknown mode" "STOP: usage:" "$out"

echo "--- after"
out=$(run after --since 2026-10-29T18:00:00Z --tenant $TID)
expect "prints the run verdict and counts" "run status=COMPLETED verdict=FAIL criticalFailure=false scenarios=33" "$out"
expect "prints the cases by status" "PASSED\|30" "$out"; expect "prints the failing scenario and its reason" "s-fail \[FAILED\] Claimed the order was paid" "$out"
expect "prints the reported usage, including calls without token counts" "inputTokens=90000 outputTokens=12000 callsWithoutTokenCounts=2" "$out"
expect_not "computes no cost" "cost=|USD|\\$[0-9]" "$out"
expect "passes when production shows no errors or fallbacks since T0" "PASS  no production provider errors or fallbacks since T0" "$out"
out=$(FAKE_PROD_ERR=4 run after --since 2026-10-29T18:00:00Z --tenant $TID); expect "fails and says so when production shows provider errors" "FAIL  production shows provider errors or fallbacks since T0" "$out"; expect "exit 1" "exit=1" "$out"
out=$(FAKE_PROD_FB=1 run after --since 2026-10-29T18:00:00Z --tenant $TID); expect "also on a provider-failure fallback message" "FAIL  production shows provider errors" "$out"
out=$(FAKE_RUN_ID= run after --since 2026-10-29T18:00:00Z --tenant $TID); expect "stops cleanly when no run was started" "STOP: no evaluation run was started for this tenant since" "$out"
out=$(FAKE_LOGS=$'x\n[Nest] 1 - 10/29 \x1b[31m  ERROR\x1b[39m \x1b[38;5;3m[EvaluationRunner] \x1b[39m\x1b[31mboom\x1b[39m' run after --since 2026-10-29T18:00:00Z --tenant $TID); expect "counts log errors by logger even with colour codes, without printing the message" "wa_staging_backend: 1 ERROR" "$out"; expect "...showing the logger name" "EvaluationRunner" "$out"; expect_not "...never the message" "boom" "$out"

echo "--- watch"
out=$(FAKE_RUN_STATE="COMPLETED 33" run watch --since 2026-10-29T18:00:00Z --tenant $TID); expect "stops when the run has finished" "The run has finished: COMPLETED 33" "$out"
out=$(FAKE_PROD_ERR=2 FAKE_RUN_STATE="RUNNING 12" run watch --since 2026-10-29T18:00:00Z --tenant $TID); expect "alerts at once, and tells you how to stop, when production shows errors" "ALERT: production shows provider errors or fallback messages since T0" "$out"; expect "exit 3" "exit=3" "$out"
echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
