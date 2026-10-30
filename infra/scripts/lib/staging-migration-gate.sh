#!/usr/bin/env bash
# Applied-migration gate for the staging release script. Sourced, never run.
#
# Every migration recorded as applied in the staging database must exist in the
# candidate with an identical checksum. The one narrow exception: staging
# carries migrations from earlier AI feature-branch deployments that were never
# merged. Those are additive, and the candidate code does not use them, so an
# operator may name them explicitly for a single release. The permitted IDs are
# fixed below; the environment variable only selects among them and can never
# introduce a new ID.

STAGING_KNOWN_EXTRA_MIGRATIONS=(
  20260708120000_verz_ai_grounded_retrieval
)

MIGRATION_GATE_ERROR=""

# Rejects any configured entry that is not an exact known ID (typos, prefixes,
# wildcards, other migrations), so a bad value fails loudly instead of being
# silently ignored.
validate_allowed_extra_migrations() {
  local entry known matched entries
  IFS=',' read -r -a entries <<< "${STAGING_ALLOWED_EXTRA_MIGRATIONS:-}"
  for entry in ${entries[@]+"${entries[@]}"}; do
    matched=false
    for known in "${STAGING_KNOWN_EXTRA_MIGRATIONS[@]}"; do
      [[ "$entry" == "$known" ]] && matched=true
    done
    if [[ "$matched" != true ]]; then
      MIGRATION_GATE_ERROR="STAGING_ALLOWED_EXTRA_MIGRATIONS contains '$entry', which is not a permitted extra migration"
      return 1
    fi
  done
}

extra_migration_allowed() {
  local name=$1 entry entries
  IFS=',' read -r -a entries <<< "${STAGING_ALLOWED_EXTRA_MIGRATIONS:-}"
  for entry in ${entries[@]+"${entries[@]}"}; do
    [[ "$entry" == "$name" ]] && return 0
  done
  return 1
}

# check_applied_migrations <candidate migrations dir> <file of "name|checksum" rows>
# Returns 1 and sets MIGRATION_GATE_ERROR on the first violation. Names of
# allowed extra migrations that were absent from the candidate are appended to
# ALLOWED_EXTRA_APPLIED so the release can record that the exception was used.
ALLOWED_EXTRA_APPLIED=()
check_applied_migrations() {
  local migration_dir=$1 remote_file=$2
  local migration_name remote_checksum migration_file local_checksum
  validate_allowed_extra_migrations || return 1
  ALLOWED_EXTRA_APPLIED=()

  while IFS='|' read -r migration_name remote_checksum; do
    [[ -n "$migration_name" ]] || continue
    migration_file="$migration_dir/$migration_name/migration.sql"
    if [[ ! -s "$migration_file" ]]; then
      # Only a migration missing from the candidate can be excused. One that is
      # present still goes through the checksum comparison below.
      if extra_migration_allowed "$migration_name"; then
        ALLOWED_EXTRA_APPLIED+=("$migration_name")
        continue
      fi
      MIGRATION_GATE_ERROR="database has applied migration $migration_name which is absent from the candidate"
      return 1
    fi
    local_checksum=$(sha256sum "$migration_file" | awk '{print $1}')
    if [[ "$local_checksum" != "$remote_checksum" ]]; then
      MIGRATION_GATE_ERROR="candidate changes already-applied migration $migration_name; do not migrate until a forward-only compatibility plan is approved"
      return 1
    fi
  done < "$remote_file"
}
