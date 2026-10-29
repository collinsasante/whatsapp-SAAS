#!/usr/bin/env bash
# STAGING ONLY. Prepares, monitors and reports ONE baseline run of the existing Commerce Evaluation. Run as root on the staging host.
#
#   1) bash infra/scripts/staging-eval-baseline.sh before  [--tenant <id>]
#   2) in the staging app: Commerce Evaluation page -> Run evaluation (once)   <- the only step that calls the model
#   3) bash infra/scripts/staging-eval-baseline.sh watch   --since <T0> --tenant <id>      (optional, while it runs)
#   4) bash infra/scripts/staging-eval-baseline.sh after   --since <T0> --tenant <id>
#
# It never starts the evaluation, changes a flag, a prompt or a setting, or writes anything. Reads of the staging database are
# SELECTs; the only reads of PRODUCTION are two COUNTS (provider errors and provider-failure fallback messages) through a session
# set read-only, to see whether the shared model key is hurting production while the run is going. No message text, key, token or
# customer data is printed. The evaluation's own scenarios and failure reasons are synthetic (an evaluation contact), not customers'.
set -u
SD=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EXPECTED_TAG=${EXPECTED_TAG:-f6b6728cfbebdba229d84fca9e77cc37cc8a323b}
EXPECTED_PROMPT=${EXPECTED_PROMPT:-1.1.0}
MAX_RUNS_PER_DAY=3
FAILS=0
pass() { echo "PASS  $*"; }
warn() { echo "WARN  $*"; }
bad()  { echo "FAIL  $*"; FAILS=$((FAILS+1)); }
die()  { echo "STOP: $*"; exit 1; }

MODE=${1:-}; shift || true
TENANT=""; SINCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tenant) TENANT=${2:-}; shift 2 ;;
    --since) SINCE=${2:-}; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
case "$MODE" in before|watch|after) ;; *) die "usage: staging-eval-baseline.sh before|watch|after [--tenant <id>] [--since <T0>]" ;; esac
[ -z "$TENANT" ] || echo "$TENANT" | grep -qE '^[0-9a-fA-F-]{36}$' || die "--tenant must be a tenant id (a UUID)"
[ -z "$SINCE" ] || echo "$SINCE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' || die "--since must look like 2026-10-29T18:00:00Z (the T0 that 'before' printed)"

# Staging database: every query is a SELECT, in a session set read-only.
sq() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' wa_staging_postgres sh -c 'psql -X -At -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }
# Production database: COUNTS only, read-only session.
pq() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' wa_postgres sh -c 'psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }

prod_counts() { # $1 = a timestamp or an interval expression already validated by the caller
  local from=$1
  printf '%s\n' \
    "SELECT count(*) FROM ai_executions WHERE status = 'PROVIDER_ERROR' AND created_at >= $from;" \
    "SELECT count(*) FROM messages WHERE direction = 'OUTBOUND' AND content LIKE 'Give me a moment -- I''m having a little trouble on my end%' AND created_at >= $from;" | pq 2>/dev/null | tr '\n' ' '
}

identity() {
  [ "$(id -u)" = 0 ] || die "not root"
  for s in backend worker realtime whatsapp_web frontend postgres redis minio nginx; do
    p=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "wa_staging_$s" 2>/dev/null) || die "wa_staging_$s does not exist"
    [ "$p" = verzchat-staging ] || die "wa_staging_$s is in project '$p', not verzchat-staging"
    [ "$(docker inspect -f '{{.State.Running}}' "wa_staging_$s")" = true ] || die "wa_staging_$s is not running"
  done
  db=$(docker exec wa_staging_postgres printenv POSTGRES_DB 2>/dev/null) || die "cannot read the database name"
  case "$db" in *_staging) ;; *) die "database '$db' does not end in _staging" ;; esac
  docker inspect wa_postgres >/dev/null 2>&1 || warn "the production database container wa_postgres was not found: production monitoring will be skipped"
}

if [ "$MODE" = before ]; then
  echo "== 1. Identity (stops here if this is not staging)"; identity; pass "nine wa_staging_* containers in project verzchat-staging; database name ends in _staging"

  echo "== 2. What is deployed (must be the images the baseline is defined against)"
  for c in backend worker; do
    img=$(docker inspect -f '{{.Config.Image}}' "wa_staging_$c")
    case "$img" in *":$EXPECTED_TAG") pass "wa_staging_$c runs the expected images (tag $EXPECTED_TAG)" ;; *) bad "wa_staging_$c runs '$img', expected tag $EXPECTED_TAG. Do not start the baseline on other code." ;; esac
  done
  active=$(echo "SELECT string_agg(v.version, ',') FROM ai_prompt_versions v JOIN ai_prompt_templates t ON t.id = v.template_id WHERE t.key = 'responder.system' AND v.status = 'ACTIVE';" | sq)
  [ "$active" = "$EXPECTED_PROMPT" ] && pass "the active responder prompt is $active" || bad "the active responder prompt is '${active:-none}', expected $EXPECTED_PROMPT"

  echo "== 3. Model key and payments"
  b=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_backend | sed -n 's/^DEEPSEEK_API_KEY=//p')
  w=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_worker | sed -n 's/^DEEPSEEK_API_KEY=//p')
  [ -n "$b" ] && [ "$b" = "$w" ] && pass "the running backend and worker hold the same model key (accepted: it is shared with production, so the run bills production and shares its rate limit)" || bad "the running backend and worker do not hold the same model key"
  unset b w
  pk=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' wa_staging_backend | sed -n 's/^PAYSTACK_SECRET_KEY=//p' | cut -c1-8)
  case "$pk" in sk_live_) bad "the staging Paystack key is a LIVE key" ;; sk_test_) pass "the Paystack key is a test key" ;; *) warn "the Paystack key is not recognisable as a test key (the evaluation uses dry-run payments and makes no Paystack call)" ;; esac
  unset pk

  echo "== 4. The staging tenant"
  if [ -z "$TENANT" ]; then
    rows=$(echo "SELECT t.id, t.name FROM tenants t JOIN tenant_settings s ON s.tenant_id = t.id WHERE t.is_active AND s.commerce_enabled AND s.ai_enabled ORDER BY t.created_at;" | sq)
    n=$(printf '%s' "$rows" | grep -c . || true)
    if [ "$n" = 1 ]; then TENANT=${rows%%|*}; pass "exactly one staging tenant is active, commerce-enabled and AI-enabled: ${rows#*|} ($TENANT)"
    elif [ "$n" = 0 ]; then bad "no staging tenant is active, commerce-enabled and AI-enabled: nothing to evaluate. (This script will not change a flag.)"
    else bad "$n staging tenants qualify; choose one with --tenant <id>:"; printf '%s\n' "$rows" | sed 's/^/        /'; fi
  else
    ok=$(echo "SELECT count(*) FROM tenants t JOIN tenant_settings s ON s.tenant_id = t.id WHERE t.id = '$TENANT' AND t.is_active AND s.commerce_enabled AND s.ai_enabled;" | sq)
    [ "$ok" = 1 ] && pass "tenant $TENANT is active, commerce-enabled and AI-enabled" || bad "tenant $TENANT is not an active, commerce-enabled, AI-enabled staging tenant"
  fi
  if [ -n "$TENANT" ] && echo "$TENANT" | grep -qE '^[0-9a-fA-F-]{36}$'; then
    # Scenarios that need a product the tenant does not have are SKIPPED (neither passed nor failed): with no catalogue, 20 of the 33 are.
    cat=$(echo "SELECT count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE is_active AND stock_quantity = 0), count(*) FILTER (WHERE is_active AND stock_quantity IS NULL) FROM commerce_products WHERE tenant_id = '$TENANT';" | sq)
    nact=${cat%%|*}; rest=${cat#*|}; nout=${rest%%|*}; nunl=${rest#*|}
    if [ "${nact:-0}" = 0 ]; then bad "this tenant has NO active products: the 20 scenarios that need a product would be skipped, so the run would say little. Add products first, or choose another tenant."
    else
      pass "active products: $nact"
      [ "${nout:-0}" = 0 ] && warn "no out-of-stock product: the 2 scenarios that need one will be skipped"
      [ "${nunl:-0}" = 0 ] && warn "no unlimited-stock product: the 1 scenario that needs one will be skipped"
    fi
    act=$(echo "SELECT count(*) FROM commerce_evaluation_runs WHERE tenant_id = '$TENANT' AND status IN ('QUEUED','RUNNING');" | sq)
    [ "$act" = 0 ] && pass "no evaluation run is queued or running for this tenant" || bad "$act evaluation run(s) are already queued or running for this tenant"
    today=$(echo "SELECT count(*) FROM commerce_evaluation_runs WHERE tenant_id = '$TENANT' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');" | sq)
    [ "${today:-9}" -lt "$MAX_RUNS_PER_DAY" ] && pass "$today evaluation run(s) started today (UTC); the daily cap is $MAX_RUNS_PER_DAY" || bad "the daily cap of $MAX_RUNS_PER_DAY runs is reached for this tenant"
  fi

  echo "== 5. Production, before the run (counts only, last 30 minutes)"
  if docker inspect wa_postgres >/dev/null 2>&1; then
    base=$(prod_counts "now() - interval '30 minutes'")
    [ -n "$base" ] && echo "INFO  provider errors / provider-failure fallback messages in production, last 30 min: $base" || warn "could not read production counts"
  fi

  echo
  T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if [ "$FAILS" = 0 ]; then
    tname=$(echo "SELECT name FROM tenants WHERE id = '$TENANT';" | sq)
    echo "READY. T0=$T0   TENANT=$TENANT"
    echo "IMPORTANT: the run is created for the workspace you are SIGNED IN TO in the staging app, not for the one this script chose. Sign in as an admin of '$tname' first,"
    echo "           and check the workspace name shown in the app. A run for another workspace still costs model calls (use 'after' with that workspace's id to read it)."
    echo "Next: in the staging app open Commerce Evaluation and press Run evaluation ONCE for that tenant. Then, optionally in a second terminal:"
    echo "  bash infra/scripts/staging-eval-baseline.sh watch --since $T0 --tenant $TENANT"
    echo "and when it finishes:"
    echo "  bash infra/scripts/staging-eval-baseline.sh after --since $T0 --tenant $TENANT"
    echo "Emergency stop (staging only): docker stop wa_staging_backend wa_staging_worker   (the run stays RUNNING until the backend is back; tell me)"
  else
    echo "NOT READY: $FAILS check(s) failed. Nothing was started."
  fi
  [ "$FAILS" = 0 ]; exit $?
fi

[ -n "$SINCE" ] && [ -n "$TENANT" ] || die "$MODE needs --since <T0> and --tenant <id>"
identity

if [ "$MODE" = watch ]; then
  echo "Watching until the run finishes or about 40 minutes pass. Production errors since T0 are compared with zero; any rise is flagged."
  for _ in $(seq 1 120); do
    st=$(echo "SELECT r.status::text || ' ' || (SELECT count(*) FROM commerce_evaluation_cases c WHERE c.evaluation_run_id = r.id)::text FROM commerce_evaluation_runs r WHERE r.tenant_id = '$TENANT' AND r.created_at >= '$SINCE' ORDER BY r.created_at DESC LIMIT 1;" | sq)
    pc=$(prod_counts "'$SINCE'")
    printf '%s  run: %-22s production errors/fallbacks since T0: %s\n' "$(date -u +%H:%M:%S)" "${st:-not started yet}" "${pc:-unknown}"
    case "$pc" in "0 0 ") ;; "") echo "      (production counts could not be read this round)" ;; *) echo "ALERT: production shows provider errors or fallback messages since T0. Stop the evaluation now (see the emergency stop above) and tell me."; exit 3 ;; esac
    case "$st" in COMPLETED*|FAILED*) echo "The run has finished: $st"; exit 0 ;; esac
    sleep 20
  done
  echo "Still running after the watch period; run 'after' later."; exit 0
fi

# --- after
echo "== Result of the evaluation run started after $SINCE for this tenant"
run=$(echo "SELECT id FROM commerce_evaluation_runs WHERE tenant_id = '$TENANT' AND created_at >= '$SINCE' ORDER BY created_at DESC LIMIT 1;" | sq)
[ -n "$run" ] || die "no evaluation run was started for this tenant since $SINCE"
echo "SELECT 'run status=' || status::text || ' verdict=' || overall_verdict::text || ' criticalFailure=' || critical_failure::text || ' scenarios=' || scenario_count::text || ' skipped=' || skipped_count::text || ' started=' || coalesce(started_at::text,'-') || ' completed=' || coalesce(completed_at::text,'-') || ' error=' || coalesce(left(error_message, 200), '-') FROM commerce_evaluation_runs WHERE id = '$run';" | sq
echo "-- cases by status"
echo "SELECT status::text, count(*) FROM commerce_evaluation_cases WHERE evaluation_run_id = '$run' GROUP BY status ORDER BY status;" | sq | sed 's/^/   /'
echo "-- criteria summary (synthetic)"
echo "SELECT coalesce(criteria_summary::text, '-') FROM commerce_evaluation_runs WHERE id = '$run';" | sq | sed 's/^/   /'
echo "-- failed or errored scenarios and their reasons (synthetic conversations; no customer data)"
echo "SELECT scenario_key || ' [' || status::text || '] ' || left(array_to_string(failure_reasons, ' ; '), 300) FROM commerce_evaluation_cases WHERE evaluation_run_id = '$run' AND status IN ('FAILED','ERRORED') ORDER BY scenario_key;" | sq | sed 's/^/   /'

echo "== Provider usage recorded for this tenant during the run (reported tokens only; no cost is computed)"
echo "WITH w AS (SELECT started_at AS s, coalesce(completed_at, now()) + interval '2 minutes' AS e FROM commerce_evaluation_runs WHERE id = '$run')
SELECT 'calls=' || count(*)::text || ' success=' || (count(*) FILTER (WHERE status = 'SUCCESS'))::text || ' providerErrors=' || (count(*) FILTER (WHERE status = 'PROVIDER_ERROR'))::text || ' inputTokens=' || coalesce(sum(input_tokens), 0)::text || ' outputTokens=' || coalesce(sum(output_tokens), 0)::text || ' callsWithoutTokenCounts=' || (count(*) FILTER (WHERE input_tokens IS NULL OR output_tokens IS NULL))::text
FROM ai_executions x, w WHERE x.tenant_id = '$TENANT' AND x.task_type = 'TEST' AND x.created_at >= w.s AND x.created_at <= w.e;" | sq | sed 's/^/   /'

echo "== Staging backend and worker log, since T0 (counts by logger; no message text)"
for c in backend worker; do
  logs=$(docker logs --since "$SINCE" "wa_staging_$c" 2>&1 | sed -E 's/\x1b\[[0-9;]*m//g')
  n=$(printf '%s\n' "$logs" | grep -c " ERROR ")
  echo "   wa_staging_$c: $n ERROR line(s)"
  printf '%s\n' "$logs" | grep " ERROR " | sed -E 's/.*ERROR +\[([A-Za-z0-9_]+)\].*/\1/' | sort | uniq -c | sort -rn | head -5 | sed 's/^/      /'
done

echo "== Production since T0 (counts only)"
if docker inspect wa_postgres >/dev/null 2>&1; then
  pc=$(prod_counts "'$SINCE'")
  echo "   provider errors / provider-failure fallback messages in production since T0: ${pc:-unknown}"
  case "$pc" in "0 0 ") echo "PASS  no production provider errors or fallbacks since T0" ;; "") warn "could not read production counts" ;; *) bad "production shows provider errors or fallbacks since T0: this run may have been the cause" ;; esac
fi
echo
[ "$FAILS" = 0 ] && echo "REPORT COMPLETE (this is the evidence, not a verdict: read the verdict and failures above)" || echo "REPORT COMPLETE WITH PROBLEMS"
[ "$FAILS" = 0 ]
