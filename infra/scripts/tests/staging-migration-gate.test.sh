#!/usr/bin/env bash
# Behavioural tests for infra/scripts/lib/staging-migration-gate.sh (no Docker or database).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
LIB="$ROOT/infra/scripts/lib/staging-migration-gate.sh"
RELEASE="$ROOT/infra/scripts/staging-release-deploy.sh"
EXTRA=20260708120000_verz_ai_grounded_retrieval
PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# shellcheck source=../lib/staging-migration-gate.sh
source "$LIB"

expect() {
  local label=$1 want=$2 got=$3
  if [[ "$want" == "$got" ]]; then
    PASS=$((PASS + 1)); echo "ok    $label"
  else
    FAIL=$((FAIL + 1)); echo "FAIL  $label (want $want, got $got)"
  fi
}

expect_error_contains() {
  local label=$1 needle=$2
  if [[ "$MIGRATION_GATE_ERROR" == *"$needle"* ]]; then
    PASS=$((PASS + 1)); echo "ok    $label"
  else
    FAIL=$((FAIL + 1)); echo "FAIL  $label (error was: $MIGRATION_GATE_ERROR)"
  fi
}

# Candidate with one migration; returns its checksum.
MIGRATIONS="$WORK/migrations"
mkdir -p "$MIGRATIONS/20260101000000_base"
echo 'SELECT 1;' > "$MIGRATIONS/20260101000000_base/migration.sql"
BASE_SUM=$(sha256sum "$MIGRATIONS/20260101000000_base/migration.sql" | awk '{print $1}')

run_gate() { # rows...
  printf '%s\n' "$@" > "$WORK/rows.txt"
  MIGRATION_GATE_ERROR=""
  check_applied_migrations "$MIGRATIONS" "$WORK/rows.txt"
}

BASE_ROW="20260101000000_base|$BASE_SUM"
EXTRA_ROW="$EXTRA|deadbeef"

unset STAGING_ALLOWED_EXTRA_MIGRATIONS
run_gate "$BASE_ROW"; expect "matching history passes" 0 $?
run_gate "$BASE_ROW" "$EXTRA_ROW"; expect "unset allow-list rejects the extra migration" 1 $?
expect_error_contains "unset allow-list keeps the strict message" "absent from the candidate"

STAGING_ALLOWED_EXTRA_MIGRATIONS=""
run_gate "$BASE_ROW" "$EXTRA_ROW"; expect "empty allow-list rejects the extra migration" 1 $?

STAGING_ALLOWED_EXTRA_MIGRATIONS=$EXTRA
run_gate "$BASE_ROW" "$EXTRA_ROW"; expect "named migration is allowed when configured" 0 $?
expect "the exception is reported for the release record" "$EXTRA" "${ALLOWED_EXTRA_APPLIED[*]}"

run_gate "$BASE_ROW" "20260202000000_other|abc"; expect "another absent migration is rejected even with the allow-list" 1 $?
expect_error_contains "rejection names the other migration" "20260202000000_other"
run_gate "$BASE_ROW" "$EXTRA_ROW" "20260202000000_other|abc"; expect "extra plus an unexpected migration is rejected" 1 $?

run_gate "20260101000000_base|0000"; expect "checksum mismatch still rejected with allow-list" 1 $?
expect_error_contains "checksum mismatch keeps its message" "candidate changes already-applied migration"

# Once the migration exists in the candidate it is checksum-checked, not excused.
mkdir -p "$MIGRATIONS/$EXTRA"
echo 'SELECT 2;' > "$MIGRATIONS/$EXTRA/migration.sql"
run_gate "$BASE_ROW" "$EXTRA_ROW"; expect "present extra migration with wrong checksum is rejected" 1 $?
rm -rf "${MIGRATIONS:?}/$EXTRA"

for bad in "${EXTRA%_*}" "20260202000000_other" "*" "${EXTRA}x" "$EXTRA,20260202000000_other" "x,$EXTRA"; do
  STAGING_ALLOWED_EXTRA_MIGRATIONS=$bad
  run_gate "$BASE_ROW"; expect "unknown allow-list value '$bad' is rejected" 1 $?
done

STAGING_ALLOWED_EXTRA_MIGRATIONS=" $EXTRA"
run_gate "$BASE_ROW" "$EXTRA_ROW"; expect "whitespace-padded value is rejected, not trimmed" 1 $?
unset STAGING_ALLOWED_EXTRA_MIGRATIONS

# Wiring and production isolation.
grep -Fq 'source "$SCRIPT_DIR/lib/staging-migration-gate.sh"' "$RELEASE"; expect "release script uses the gate library" 0 $?
grep -Fq 'validate_allowed_extra_migrations || fail' "$RELEASE"; expect "release validates the allow-list before building" 0 $?
leaks=$(grep -rl 'STAGING_ALLOWED_EXTRA_MIGRATIONS\|staging-migration-gate' \
  "$ROOT/infra/scripts" "$ROOT/.github" "$ROOT/deploy.sh" "$ROOT/infra/docker-compose.yml" "$ROOT/infra/docker-compose.dev.yml" "$ROOT/infra/.env.example" 2>/dev/null |
  grep -v -e 'staging-release-deploy.sh' -e 'lib/staging-migration-gate.sh' -e 'tests/staging-migration-gate.test.sh' | wc -l | tr -d ' ')
expect "production deploy scripts, workflows and compose files never reference the allow-list" 0 "$leaks"

echo "---"
echo "passed: $PASS  failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
