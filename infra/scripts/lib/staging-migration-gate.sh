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

# check_prisma_migrate_status <status output file> <exit code> <candidate migrations dir> <file of "name|checksum" rows>
#
# `prisma migrate status` exits 1 whenever the candidate has migrations the database has not applied yet, which is exactly what a
# release that ships a migration looks like, and whenever the database holds a migration the candidate lacks. Treating every non-zero
# exit as a failure made it impossible to release a candidate with a migration. This accepts a non-zero exit ONLY when every line of
# the output is understood and describes one of two expected things:
#   1. pending migrations: each must exist in the candidate and must not already be recorded as applied;
#   2. migrations only in the database: each must be a permitted, explicitly named extra that check_applied_migrations already
#      excused for this release (ALLOWED_EXTRA_APPLIED).
# Anything else (a failed or rolled-back migration, a modified one, an unknown line, an empty report, another exit code) is refused
# and the reason is placed in MIGRATION_GATE_ERROR. Pending migrations are applied later by `prisma migrate deploy`, behind the
# backup and restore rehearsal; this function only decides that the history is in an expected shape.
check_prisma_migrate_status() {
  local status_file=$1 exit_code=$2 migration_dir=$3 applied_file=$4
  local line id is_id section="" recognised=false known allowed

  if [[ "$exit_code" == 0 ]]; then
    return 0
  fi
  if [[ "$exit_code" != 1 ]]; then
    MIGRATION_GATE_ERROR="prisma migrate status exited with code $exit_code"
    return 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    # Words that mean something went wrong. Not applied to a migration ID inside a recognised list: names are free text
    # (this repository has 20260903190000_error_and_webhook_logs), so an ID must never be mistaken for a report of an error.
    is_id=false
    if [[ -n "$section" && "$line" =~ ^[0-9]{14}_[A-Za-z0-9_]+$ ]]; then is_id=true; fi
    if [[ "$is_id" != true ]] && printf '%s' "$line" | grep -Eiq 'fail|rolled|modified|checksum|drift|error|P[0-9]{4}|cannot|unable'; then
      MIGRATION_GATE_ERROR="prisma migrate status reported a problem: ${line:0:120}"
      return 1
    fi
    case "$line" in
      "")
        section="" ;;
      "The migrations have not yet been applied:" | "The migration has not yet been applied:" | \
      "Following migration have not yet been applied:" | "Following migrations have not yet been applied:")
        section=pending; recognised=true ;;
      "The migration from the database are not found locally in prisma/migrations:" | \
      "The migrations from the database are not found locally in prisma/migrations:")
        section=extra; recognised=true ;;
      *" Container "* | "Container "* | "Prisma schema loaded from "* | "Datasource "* | *" migrations found in prisma/migrations" | \
      "Your local migration history and the migrations table from your database are different:" | \
      "The last common migration is: "* | "Database schema is not up to date" | "To apply migrations in "*)
        section="" ;;
      *)
        if [[ -z "$section" || ! "$line" =~ ^[0-9]{14}_[A-Za-z0-9_]+$ ]]; then
          MIGRATION_GATE_ERROR="prisma migrate status printed something unexpected: ${line:0:120}"
          return 1
        fi
        id=$line
        if [[ "$section" == pending ]]; then
          if [[ ! -s "$migration_dir/$id/migration.sql" ]]; then
            MIGRATION_GATE_ERROR="prisma reports pending migration $id, which is not in the candidate"
            return 1
          fi
          if cut -d'|' -f1 "$applied_file" | grep -qxF "$id"; then
            MIGRATION_GATE_ERROR="prisma reports $id as pending but the database records it as applied"
            return 1
          fi
        else
          allowed=false
          for known in ${ALLOWED_EXTRA_APPLIED[@]+"${ALLOWED_EXTRA_APPLIED[@]}"}; do
            [[ "$known" == "$id" ]] && allowed=true
          done
          if [[ "$allowed" != true ]]; then
            MIGRATION_GATE_ERROR="database has migration $id that is absent from the candidate and was not explicitly permitted for this release"
            return 1
          fi
        fi ;;
    esac
  done < "$status_file"

  if [[ "$recognised" != true ]]; then
    MIGRATION_GATE_ERROR="prisma migrate status failed without describing pending or database-only migrations"
    return 1
  fi
}
