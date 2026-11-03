#!/usr/bin/env bash
# AI-learning settings in BOTH Compose files: passed to the backend only, safe when missing, and in step with the code that reads them.
# Names and the harmless test values below only; no real configuration is read (--env-file /dev/null, empty environment).
# Run: bash infra/scripts/tests/learning-compose-env.test.sh
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok    $1"; }
no() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
VARS="AI_LEARNING_OPT_IN_OPEN AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD AI_LEARNING_MAX_RESERVATION_USD AI_LEARNING_RETENTION_ENABLED AI_LEARNING_RETENTION_FREE_TEXT_DAYS AI_LEARNING_RETENTION_METRICS_MONTHS"

block() { awk -v svc="  $2:" '$0 == svc {on=1; next} on && /^  [A-Za-z0-9_-]+:/ {exit} on {print}' "$1"; }
have_compose=false; command -v docker-compose >/dev/null 2>&1 && have_compose=true

# Rendered "NAME: value" of one service, with an environment we control. Interpolation warnings for unrelated unset variables go to /dev/null.
render() { # compose-file service [VAR=value ...]
  local f=$1 svc=$2; shift 2
  env -i PATH="$PATH" HOME="${TMPDIR:-/tmp}" "$@" docker-compose --env-file /dev/null -f "$f" config 2>/dev/null |
    awk -v svc="  $svc:" '$0 == svc {on=1; next} on && /^  [A-Za-z0-9_-]+:/ {exit} on {print}'
}

for pair in "production:$ROOT/infra/docker-compose.yml:$ROOT/infra/.env.example" "staging:$ROOT/infra/docker-compose.staging.yml:$ROOT/infra/.env.staging.example"; do
  name=${pair%%:*}; rest=${pair#*:}; compose=${rest%%:*}; example=${rest#*:}

  # --- source text: backend passes every variable, the worker none, with the safe default -------------------------------------------
  for v in $VARS; do
    block "$compose" backend | grep -Eq "^      $v: \\$\\{$v:-" && ok "$name backend passes $v with a default" || no "$name backend passes $v with a default"
    block "$compose" worker | grep -Eq "$v" && no "$name worker must not receive $v (it has no learning code)" || ok "$name worker does not receive $v"
  done
  block "$compose" backend | grep -Eq '^      AI_LEARNING_OPT_IN_OPEN: \$\{AI_LEARNING_OPT_IN_OPEN:-false\}$' && ok "$name opt-in defaults to CLOSED" || no "$name opt-in defaults to closed"
  block "$compose" backend | grep -Eq '^      AI_LEARNING_RETENTION_ENABLED: \$\{AI_LEARNING_RETENTION_ENABLED:-false\}$' && ok "$name retention defaults to OFF" || no "$name retention defaults to off"
  for v in AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD AI_LEARNING_MAX_RESERVATION_USD AI_LEARNING_RETENTION_FREE_TEXT_DAYS AI_LEARNING_RETENTION_METRICS_MONTHS; do
    block "$compose" backend | grep -Eq "^      $v: \\$\\{$v:-\\}\$" && ok "$name $v defaults to empty (the code default applies)" || no "$name $v defaults to empty"
  done
  # No secret may be introduced by this block.
  grep -E 'AI_LEARNING_' "$compose" | grep -Eiq 'KEY|SECRET|TOKEN|PASSWORD' && no "$name AI-learning lines mention a secret-like name" || ok "$name AI-learning lines contain no secret-like name"

  # --- the example file documents every variable, with the SAFE value --------------------------------------------------------------
  for v in $VARS; do grep -Eq "^$v=" "$example" && ok "$(basename "$example") lists $v" || no "$(basename "$example") lists $v"; done
  grep -Eq '^AI_LEARNING_OPT_IN_OPEN=false$' "$example" && ok "$(basename "$example") ships opt-in CLOSED" || no "$(basename "$example") ships opt-in closed"
  grep -Eq '^AI_LEARNING_RETENTION_ENABLED=false$' "$example" && ok "$(basename "$example") ships retention OFF" || no "$(basename "$example") ships retention off"

  # --- rendered by Compose itself --------------------------------------------------------------------------------------------------
  if $have_compose; then
    empty=$(render "$compose" backend)
    [ -n "$empty" ] && ok "$name backend renders with an empty environment" || no "$name backend renders with an empty environment"
    echo "$empty" | grep -Eq '^      AI_LEARNING_OPT_IN_OPEN: "?false"?$' && ok "$name: MISSING variables leave opt-in closed" || no "$name: missing variables leave opt-in closed"
    echo "$empty" | grep -Eq '^      AI_LEARNING_RETENTION_ENABLED: "?false"?$' && ok "$name: MISSING variables leave retention off" || no "$name: missing variables leave retention off"
    echo "$empty" | grep -Eq '^      AI_LEARNING_(WORKSPACE|GLOBAL)_MONTHLY_BUDGET_USD: ""$' && ok "$name: MISSING budgets render empty (code defaults)" || no "$name: missing budgets render empty"
    full=$(render "$compose" backend AI_LEARNING_OPT_IN_OPEN=true AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD=7 AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD=70 AI_LEARNING_MAX_RESERVATION_USD=0.07 AI_LEARNING_RETENTION_ENABLED=true AI_LEARNING_RETENTION_FREE_TEXT_DAYS=45 AI_LEARNING_RETENTION_METRICS_MONTHS=6)
    for kv in 'AI_LEARNING_OPT_IN_OPEN: "true"' 'AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD: "7"' 'AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD: "70"' 'AI_LEARNING_MAX_RESERVATION_USD: "0.07"' 'AI_LEARNING_RETENTION_ENABLED: "true"' 'AI_LEARNING_RETENTION_FREE_TEXT_DAYS: "45"' 'AI_LEARNING_RETENTION_METRICS_MONTHS: "6"'; do
      echo "$full" | grep -Fq "      $kv" && ok "$name passes through $kv" || no "$name passes through $kv"
    done
    render "$compose" worker AI_LEARNING_OPT_IN_OPEN=true | grep -q AI_LEARNING && no "$name worker leaks AI_LEARNING_*" || ok "$name worker renders no AI_LEARNING_*"
    # Existing wiring is untouched: the backend still depends on healthy postgres and redis and still mounts its uploads volume.
    rendered_all=$(env -i PATH="$PATH" HOME="${TMPDIR:-/tmp}" docker-compose --env-file /dev/null -f "$compose" config 2>/dev/null)
    echo "$rendered_all" | grep -q 'condition: service_healthy' && ok "$name keeps its health-checked dependencies" || no "$name keeps its health-checked dependencies"
  else
    echo "skip  $name rendered checks: docker-compose is not installed here"
  fi
done

# --- code and Compose agree on the set of variables ---------------------------------------------------------------------------------
# Only genuine environment reads (env['AI_LEARNING_X'] / env.AI_LEARNING_X), outside specs; TypeScript constants that merely contain the prefix do not count.
in_code=$(grep -rhoE "env(\.|\[')AI_LEARNING_[A-Z_]+" "$ROOT/apps/backend/src" --include='*.ts' --exclude='*.spec.ts' 2>/dev/null | sed -E "s/^env(\.|\[')//" | grep -v '_TEST_' | sort -u | tr '\n' ' ')
expected=$(echo $VARS | tr ' ' '\n' | sort -u | tr '\n' ' ')
[ "$in_code" = "$expected" ] && ok "the backend reads exactly the variables Compose passes" || no "backend reads [$in_code] but Compose passes [$expected]"

echo "---"; echo "passed: $PASS  failed: $FAIL"; [ "$FAIL" -eq 0 ]
