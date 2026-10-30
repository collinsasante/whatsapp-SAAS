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

# ---- prisma migrate status: a release that ships a migration exits 1, and that must be accepted only when fully understood.
PENDING_A=20261030120000_ai_digital_self
PENDING_B=20261030130000_digital_self_learning_exclusion
PENDING_ERR=20260903190000_error_and_webhook_logs   # a real name containing the word "error"
for m in "$PENDING_A" "$PENDING_B" "$PENDING_ERR"; do mkdir -p "$MIGRATIONS/$m"; echo 'SELECT 1;' > "$MIGRATIONS/$m/migration.sql"; done

# Verbatim from the staging run that was aborted (apps/backend, Prisma 5.22), including Compose noise.
STAGING_STATUS=$'
 Container verzchat-staging-backend-run-94d8ae76aa4b Creating 
 Container verzchat-staging-backend-run-94d8ae76aa4b Created 
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "waplatform_staging", schema "public" at "postgres:5432"

94 migrations found in prisma/migrations
Your local migration history and the migrations table from your database are different:

The last common migration is: 20261026120000_preserve_legacy_schema_values

The migrations have not yet been applied:
20261030120000_ai_digital_self
20261030130000_digital_self_learning_exclusion

The migration from the database are not found locally in prisma/migrations:
20260708120000_verz_ai_grounded_retrieval
'

status_gate() { # <output text> <exit code>
  printf '%s\n' "$1" > "$WORK/status.txt"
  MIGRATION_GATE_ERROR=""
  check_prisma_migrate_status "$WORK/status.txt" "$2" "$MIGRATIONS" "$WORK/rows.txt"
}
# The applied history as the staging database holds it, with the permitted extra excused for this release.
STAGING_ALLOWED_EXTRA_MIGRATIONS=$EXTRA
run_gate "$BASE_ROW" "$EXTRA_ROW"; expect "(setup) the extra migration is excused for this release" 0 $?

status_gate "" 0; expect "exit 0 passes" 0 $?
status_gate "$STAGING_STATUS" 1; expect "the real staging output (pending + permitted extra) is accepted" 0 $?
status_gate "" 1; expect "exit 1 with an empty report is refused" 1 $?
expect_error_contains "an empty report names the problem" "without describing"
status_gate "Database schema is up to date!" 1; expect "contradictory output (up to date, but exit 1) is refused" 1 $?
expect_error_contains "...as unexpected" "something unexpected"
status_gate "$STAGING_STATUS" 2; expect "any other exit code is refused" 1 $?
status_gate "$STAGING_STATUS" 127; expect "a missing binary (127) is refused" 1 $?

# The extra is only excused when it was explicitly permitted for this release.
STAGING_ALLOWED_EXTRA_MIGRATIONS=""
run_gate "$BASE_ROW"; ALLOWED_EXTRA_APPLIED=()
status_gate "$STAGING_STATUS" 1; expect "a database-only migration that was not permitted is refused" 1 $?
expect_error_contains "...with a message saying so" "not explicitly permitted"
STAGING_ALLOWED_EXTRA_MIGRATIONS=$EXTRA
run_gate "$BASE_ROW" "$EXTRA_ROW"

status_gate "${STAGING_STATUS//$PENDING_B/20261030999999_not_in_candidate}" 1; expect "a pending migration that is not in the candidate is refused" 1 $?
expect_error_contains "...with a message saying so" "not in the candidate"
run_gate "$BASE_ROW" "$EXTRA_ROW" "$PENDING_A|abc"
status_gate "$STAGING_STATUS" 1; expect "a pending migration the database already records as applied is refused" 1 $?
run_gate "$BASE_ROW" "$EXTRA_ROW"

status_gate $'The migrations have not yet been applied:\n'"$PENDING_ERR"$'\n' 1; expect "a migration whose NAME contains 'error' is not mistaken for an error" 0 $?

# Things that must still abort the release.
status_gate $'Prisma schema loaded from prisma/schema.prisma\n1 migration found in prisma/migrations\nFollowing migration have failed:\n'"$PENDING_A"$'\n\nDuring development you can run prisma migrate dev to reset' 1
expect "a failed migration is refused" 1 $?
status_gate $'The migrations have not yet been applied:\n'"$PENDING_A"$'\nThe migration `20260101000000_base` was modified after it was applied.' 1
expect "a migration modified after it was applied is refused" 1 $?
status_gate "${STAGING_STATUS}"$'\nSomething new Prisma started printing' 1; expect "an unrecognised line is refused rather than ignored" 1 $?
expect_error_contains "...and quoted so it can be read" "Something new Prisma started printing"
status_gate $'Error: P1001: Can\'t reach database server' 1; expect "a connection error is refused" 1 $?

unset STAGING_ALLOWED_EXTRA_MIGRATIONS

# The release script uses it, and no longer treats every non-zero exit as a failed check.
grep -Fq 'check_prisma_migrate_status "$BACKUP_DIR/prisma-migrate-status.txt" "$STATUS_RC"' "$RELEASE"; expect "release script checks the status output with the parser" 0 $?
grep -Fq 'migrate status --schema /app/prisma/schema.prisma \' "$RELEASE"; expect "release script still runs prisma migrate status" 0 $?
! grep -A1 'migrate status --schema' "$RELEASE" | grep -Fq '|| fail "Prisma migration history check failed"'; expect "release script no longer fails on any non-zero status" 0 $?
! grep -Fq 'migrate status' "$RELEASE" || true

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
