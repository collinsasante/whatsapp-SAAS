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

# check_prisma_migrate_status <exit code of `prisma migrate status`> <its saved output> <candidate migrations dir> <file of "name|checksum" rows>
# `prisma migrate status` exits 1 whenever migrations are pending, which is the expected state before a release that ships migrations.
# So a non-zero exit is accepted only when the output says nothing but "these migrations are not yet applied" and that list is EXACTLY
# the candidate's migrations minus the ones recorded as applied. Any other line (failed or modified migrations, drift, a connection error,
# an unexpected pending name, a missing expected one) rejects the release. Sets MIGRATION_GATE_ERROR on rejection.
check_prisma_migrate_status() {
  local rc=$1 out=$2 migration_dir=$3 applied_file=$4
  [[ "$rc" == "0" ]] && return 0
  local expected pending line in_list=0 saw_header=0
  expected=$(
    comm -23 \
      <(find "$migration_dir" -mindepth 2 -maxdepth 2 -name migration.sql -print | awk -F/ '{print $(NF-1)}' | sort -u) \
      <(cut -d'|' -f1 "$applied_file" | sort -u)
  )
  pending=""
  while IFS= read -r line; do
    line=${line%$'\r'}
    [[ -z "${line//[[:space:]]/}" ]] && { in_list=0; continue; }
    if [[ "$line" =~ ^[[:space:]]*Container\ .+\ (Creating|Created|Starting|Started|Running|Removing|Removed)[[:space:]]*$ ]]; then continue; fi
    if [[ "$line" == "Prisma schema loaded from "* || "$line" == "Datasource "* ]]; then continue; fi
    if [[ "$line" =~ ^[0-9]+\ migrations?\ found\ in\  ]]; then continue; fi
    if [[ "$line" =~ ^Following\ migrations?\ have\ not\ yet\ been\ applied:$ ]]; then in_list=1; saw_header=1; continue; fi
    if [[ "$line" == "To apply migrations in development run prisma migrate dev." || "$line" == "To apply migrations in production run prisma migrate deploy." ]]; then in_list=0; continue; fi
    if (( in_list )) && [[ "$line" =~ ^[0-9]{14}_[A-Za-z0-9_]+$ ]]; then pending+="$line"$'\n'; continue; fi
    MIGRATION_GATE_ERROR="prisma migrate status (exit $rc) reported something other than pending migrations: ${line:0:120}"
    return 1
  done < "$out"
  if (( ! saw_header )); then
    MIGRATION_GATE_ERROR="prisma migrate status failed (exit $rc) without reporting pending migrations"
    return 1
  fi
  pending=$(printf '%s' "$pending" | sort -u)
  if [[ "$pending" != "$expected" ]]; then
    MIGRATION_GATE_ERROR="pending migrations differ from the candidate's unapplied set (pending: $(echo $pending); expected: $(echo $expected))"
    return 1
  fi
}
