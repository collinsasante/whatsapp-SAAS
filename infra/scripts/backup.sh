#!/usr/bin/env bash
# VerzChat production backup: PostgreSQL (validated) and a Redis snapshot, LOCAL ONLY.
#
#   backup.sh                         back up into $BACKUP_DEST (default /opt/backups/whatsapp-platform)
#   backup.sh --dest DIR              back up into DIR (use a new directory to validate without touching existing backups)
#   backup.sh --verify-restore        after backing up, restore the new dump into a throwaway database and compare (backup-restore-test.sh)
#   backup.sh --prune                 ALSO delete backups older than RETAIN_DAYS, never fewer than MIN_KEEP newer validated ones (off by default)
#   backup.sh --no-redis              PostgreSQL only
#   backup.sh --check-freshness HOURS exit 1 unless the last run succeeded within HOURS (for monitoring); changes nothing
#   backup.sh --env-file FILE         read only the few keys it needs from FILE (default: ../.env). The file is NEVER sourced: it is a docker-compose env file
#                                     whose values may contain spaces, quotes or '$', and sourcing it as shell broke the previous version at SMTP_PASS (line 49).
#
# Guarantees: strict mode and pipefail (a failed pg_dump can no longer leave a "successful" file); the dump is written to a partial file, validated
# (gzip integrity, pg_dump completion marker, table count and migration-row count against the live database) and only then moved into place with
# 0600 permissions and a .sha256; an existing file is never overwritten; secrets and row data are never logged; one run at a time (flock).
# Not covered here (see docs/BACKUP_AND_DR.md): MinIO media, .env/secrets, off-host copies. Nothing in this script transmits data anywhere.
set -Eeuo pipefail
umask 077
IFS=$' \n\t'

DEST=${BACKUP_DEST:-/opt/backups/whatsapp-platform}
ENV_FILE=${BACKUP_ENV_FILE:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"}
PG_CONTAINER=${PG_CONTAINER:-wa_postgres}
REDIS_CONTAINER=${REDIS_CONTAINER:-wa_redis}
RETAIN_DAYS=${RETAIN_DAYS:-7}
MIN_KEEP=${MIN_KEEP:-7}
MIN_FREE_MB=${MIN_FREE_MB:-2048}
REDIS_WAIT_S=${REDIS_WAIT_S:-60}
BACKUP_TS=${BACKUP_TS:-$(date +%Y%m%d_%H%M%S)}
MODE=backup; DO_PRUNE=0; DO_REDIS=1; VERIFY_RESTORE=0; FRESH_HOURS=
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

while [ $# -gt 0 ]; do
  case $1 in
    --dest) DEST=${2:?--dest needs a directory}; shift 2;;
    --env-file) ENV_FILE=${2:?--env-file needs a file}; shift 2;;
    --prune) DO_PRUNE=1; shift;;
    --no-redis) DO_REDIS=0; shift;;
    --verify-restore) VERIFY_RESTORE=1; shift;;
    --check-freshness) MODE=freshness; FRESH_HOURS=${2:?--check-freshness needs hours}; shift 2;;
    -h|--help) sed -n '2,19p' "$0"; exit 0;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done

STATUS=$DEST/.last-status.json
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

if [ "$MODE" = freshness ]; then
  [ -r "$STATUS" ] || { log "no status file at $STATUS"; exit 1; }
  res=$(sed -n 's/.*"result": *"\([A-Z]*\)".*/\1/p' "$STATUS" | head -1); fin=$(sed -n 's/.*"finished_epoch": *\([0-9]*\).*/\1/p' "$STATUS" | head -1)
  [ "$res" = OK ] || { log "last run did not succeed (result=${res:-unknown})"; exit 1; }
  age=$(( $(date +%s) - ${fin:-0} )); [ "$age" -le $(( FRESH_HOURS * 3600 )) ] || { log "last successful backup is $((age / 3600)) h old (limit ${FRESH_HOURS} h)"; exit 1; }
  log "OK: last successful backup finished $((age / 60)) min ago"; exit 0
fi

# ---- state recorded by the EXIT trap -------------------------------------------------------------------------------------------------
RESULT=FAIL; MESSAGE="did not finish"; PG_FILE=; PG_SHA=; PG_BYTES=0; PG_TABLES=0; PG_MIGS=0; REDIS_FILE=; REDIS_SHA=; WARNINGS=; PARTIALS=(); STARTED=$(date +%s)
json_escape() { printf '%s' "$1" | tr -d '\000-\037"\\' | cut -c1-300; }
write_status() {
  [ -d "$DEST" ] || return 0
  local tmp; tmp=$(mktemp "$DEST/.status.XXXXXX") || return 0
  printf '{\n  "result": "%s",\n  "message": "%s",\n  "started_epoch": %s,\n  "finished_epoch": %s,\n  "postgres_file": "%s",\n  "postgres_sha256": "%s",\n  "postgres_bytes": %s,\n  "postgres_tables": %s,\n  "postgres_migration_rows": %s,\n  "redis_file": "%s",\n  "redis_sha256": "%s",\n  "warnings": "%s"\n}\n' \
    "$RESULT" "$(json_escape "$MESSAGE")" "$STARTED" "$(date +%s)" "$(json_escape "${PG_FILE##*/}")" "$PG_SHA" "$PG_BYTES" "$PG_TABLES" "$PG_MIGS" "$(json_escape "${REDIS_FILE##*/}")" "$REDIS_SHA" "$(json_escape "$WARNINGS")" > "$tmp" \
    && chmod 600 "$tmp" && mv -f "$tmp" "$STATUS" || rm -f "$tmp"
}
cleanup() { local rc=$?; local f; for f in "${PARTIALS[@]:-}"; do [ -n "$f" ] && rm -f -- "$f"; done
  [ "$RESULT" = OK ] || { [ "$rc" -ne 0 ] || rc=1; log "FAILED: $MESSAGE"; }
  write_status; exit "$rc"; }
trap cleanup EXIT
trap 'MESSAGE="unexpected error at line $LINENO"' ERR
fail() { MESSAGE=$1; exit 1; }

# ---- reading configuration WITHOUT executing it -------------------------------------------------------------------------------------
env_get() { # env_get KEY -> value of the first KEY=... line, surrounding quotes removed; nothing is evaluated
  local k=$1 line v; [ -r "$ENV_FILE" ] || return 0
  line=$(grep -m1 -E "^[[:space:]]*(export[[:space:]]+)?${k}=" "$ENV_FILE" || true); [ -n "$line" ] || return 0
  v=${line#*=}; v=${v%$'\r'}
  case $v in \"*\") v=${v#\"}; v=${v%\"};; \'*\') v=${v#\'}; v=${v%\'};; esac
  printf '%s' "$v"
}
PGUSER=${POSTGRES_USER:-$(env_get POSTGRES_USER)}; PGUSER=${PGUSER:-waplatform}
PGDB=${POSTGRES_DB:-$(env_get POSTGRES_DB)}; PGDB=${PGDB:-waplatform}
REDIS_PW=${REDIS_PASSWORD:-$(env_get REDIS_PASSWORD)}
[[ $PGUSER =~ ^[A-Za-z0-9_]+$ ]] && [[ $PGDB =~ ^[A-Za-z0-9_]+$ ]] || fail "POSTGRES_USER/POSTGRES_DB contain unexpected characters"

psql_live() { docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -Atc "$1"; }
# the password goes through the environment (docker exec -e NAME, no value), never on a command line where `ps` would show it
rcli() { if [ -n "$REDIS_PW" ]; then REDISCLI_AUTH="$REDIS_PW" docker exec -e REDISCLI_AUTH "$REDIS_CONTAINER" redis-cli "$@"; else docker exec "$REDIS_CONTAINER" redis-cli "$@"; fi; }

# ---- preflight --------------------------------------------------------------------------------------------------------------------------
mkdir -p "$DEST"; chmod 700 "$DEST"
exec 9> "$DEST/.backup.lock"; flock -n 9 || fail "another backup is already running"
[ -w "$DEST" ] || fail "$DEST is not writable"
free_mb=$(df -Pm "$DEST" | awk 'NR==2{print $4}'); [ "${free_mb:-0}" -ge "$MIN_FREE_MB" ] || fail "only ${free_mb:-0} MB free in $DEST (need $MIN_FREE_MB)"
docker exec "$PG_CONTAINER" pg_isready -U "$PGUSER" -d "$PGDB" -q || fail "PostgreSQL in $PG_CONTAINER is not ready"
log "backup started: dest=$DEST pg=$PG_CONTAINER/$PGDB redis=$([ $DO_REDIS = 1 ] && echo $REDIS_CONTAINER || echo skipped) free=${free_mb}MB"

# ---- PostgreSQL -----------------------------------------------------------------------------------------------------------------------
dump_rows() { # per-table COPY row counts from a dump on stdin -> "table=rows" lines
  awk '/^COPY /{t=$2; n=0; f=1; next} f&&/^\\\.$/{print t "=" n; f=0; next} f{n++}'; }

validate_pg_dump() { # validate_pg_dump FILE ; sets PG_TABLES / PG_MIGS ; returns non-zero with MESSAGE set on any problem
  local f=$1 tail_ok tables live_tables mig_dump mig_live prev prev_bytes bytes
  gzip -t -- "$f" 2>/dev/null || { MESSAGE="dump is not a valid gzip stream"; return 1; }
  tail_ok=$(gzip -dc -- "$f" | tail -n 5 | grep -c 'PostgreSQL database dump complete' || true)
  [ "$tail_ok" -ge 1 ] || { MESSAGE="dump has no 'PostgreSQL database dump complete' marker (truncated?)"; return 1; }
  tables=$(gzip -dc -- "$f" | grep -c '^CREATE TABLE ' || true)
  live_tables=$(psql_live "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")
  [ "$tables" -ge 1 ] && [ "$tables" = "$live_tables" ] || { MESSAGE="dump has $tables tables but the database has $live_tables"; return 1; }
  mig_dump=$(gzip -dc -- "$f" | dump_rows | grep -E '^(public\.)?_prisma_migrations=' | head -1 | cut -d= -f2 || true)
  mig_live=$(psql_live 'select count(*) from _prisma_migrations')
  [ -n "$mig_dump" ] && [ "$mig_dump" = "$mig_live" ] || { MESSAGE="dump has ${mig_dump:-no} migration rows but the database has $mig_live"; return 1; }
  bytes=$(stat -c %s -- "$f"); prev=$(ls -t -- "$DEST"/postgres_*.sql.gz 2>/dev/null | head -1 || true)
  if [ -n "$prev" ]; then prev_bytes=$(stat -c %s -- "$prev")
    [ "$bytes" -ge $(( prev_bytes / 2 )) ] || { MESSAGE="dump is under half the size of the previous one ($bytes vs $prev_bytes bytes)"; return 1; }
    [ "$bytes" -ge $(( prev_bytes * 8 / 10 )) ] || WARNINGS="${WARNINGS}dump is more than 20% smaller than the previous one; "
  fi
  PG_TABLES=$tables; PG_MIGS=$mig_dump; PG_BYTES=$bytes
}

dump_postgres() {
  local final=$DEST/postgres_${BACKUP_TS}.sql.gz part=$DEST/.postgres_${BACKUP_TS}.sql.gz.partial.$$ rcs
  [ ! -e "$final" ] || fail "refusing to overwrite the existing $final"
  PARTIALS+=("$part")
  set +e; docker exec "$PG_CONTAINER" pg_dump -U "$PGUSER" --no-password "$PGDB" | gzip -9 > "$part"; rcs=("${PIPESTATUS[@]}"); set -e
  [ "${rcs[0]}" = 0 ] && [ "${rcs[1]}" = 0 ] || fail "pg_dump/gzip failed (exit codes ${rcs[0]} ${rcs[1]})"
  validate_pg_dump "$part" || exit 1
  PG_SHA=$(sha256sum -- "$part" | cut -d' ' -f1)
  mv -n -- "$part" "$final"; [ ! -e "$part" ] || fail "could not move the validated dump into place (target exists?)"
  chmod 600 -- "$final"; printf '%s  %s\n' "$PG_SHA" "$(basename "$final")" > "$final.sha256"; chmod 600 -- "$final.sha256"
  PG_FILE=$final; log "PostgreSQL backup validated: $(basename "$final") ($(du -h -- "$final" | cut -f1), ${PG_TABLES} tables, ${PG_MIGS} migration rows, sha256 ${PG_SHA:0:16})"
}

# ---- Redis ------------------------------------------------------------------------------------------------------------------------------
snapshot_redis() {
  local final=$DEST/redis_${BACKUP_TS}.rdb part=$DEST/.redis_${BACKUP_TS}.rdb.partial.$$ before after i in_progress remote local_sha check_out ping
  [ ! -e "$final" ] || fail "refusing to overwrite the existing $final"
  PARTIALS+=("$part")
  # A password configured in the env file is only used if the server actually requires one (this server did not, on 2026-11-04: REDIS_PASSWORD was set but never enforced)
  ping=$(docker exec "$REDIS_CONTAINER" redis-cli PING 2>&1 || true)
  if [ "${ping%%$'\n'*}" = PONG ] && [ -n "$REDIS_PW" ]; then REDIS_PW=; WARNINGS="${WARNINGS}Redis accepts unauthenticated connections although REDIS_PASSWORD is set in the env file; "; fi
  before=$(rcli LASTSAVE | tr -d '\r'); rcli BGSAVE >/dev/null || fail "Redis BGSAVE was refused"
  for i in $(seq 1 "$REDIS_WAIT_S"); do
    after=$(rcli LASTSAVE | tr -d '\r'); in_progress=$(rcli INFO persistence | tr -d '\r' | sed -n 's/^rdb_bgsave_in_progress://p')
    [ "$after" != "$before" ] && [ "$in_progress" = 0 ] && break; sleep 1
  done
  [ "$after" != "$before" ] && [ "$in_progress" = 0 ] || fail "Redis BGSAVE did not finish within ${REDIS_WAIT_S} s"
  docker cp "$REDIS_CONTAINER:/data/dump.rdb" "$part" >/dev/null || fail "could not copy dump.rdb out of $REDIS_CONTAINER"
  [ -s "$part" ] || fail "copied Redis snapshot is empty"
  remote=$(docker exec "$REDIS_CONTAINER" sha256sum /data/dump.rdb | cut -d' ' -f1); local_sha=$(sha256sum -- "$part" | cut -d' ' -f1)
  [ "$remote" = "$local_sha" ] || fail "Redis snapshot changed or was corrupted while copying"
  # the whole output is evaluated (the verdict line is followed by [info] lines), together with the tool's exit status
  check_out=$(docker exec "$REDIS_CONTAINER" redis-check-rdb /data/dump.rdb 2>&1) && grep -q 'RDB looks OK' <<<"$check_out" || fail "redis-check-rdb does not accept the snapshot"
  mv -n -- "$part" "$final"; [ ! -e "$part" ] || fail "could not move the Redis snapshot into place"
  chmod 600 -- "$final"; printf '%s  %s\n' "$local_sha" "$(basename "$final")" > "$final.sha256"; chmod 600 -- "$final.sha256"
  REDIS_FILE=$final; REDIS_SHA=$local_sha; log "Redis snapshot validated: $(basename "$final") ($(du -h -- "$final" | cut -f1), sha256 ${local_sha:0:16})"
}

# ---- retention (opt-in): only our own file names, only validated successors, never the newest MIN_KEEP -----------------------------------
prune_old() {
  local keep_list f n=0 kinds
  for kinds in 'postgres_*.sql.gz' 'redis_*.rdb'; do
    keep_list=$(ls -t -- "$DEST"/$kinds 2>/dev/null | head -n "$MIN_KEEP" || true)
    while IFS= read -r f; do [ -n "$f" ] || continue
      grep -qxF -- "$f" <<<"$keep_list" && continue
      [ "$(find "$f" -mtime +"$RETAIN_DAYS" -print | wc -l)" = 1 ] || continue
      [ -f "$f.sha256" ] || { log "keeping $(basename "$f"): no .sha256 sidecar (not created by this script)"; continue; }
      rm -f -- "$f" "$f.sha256"; n=$((n + 1)); log "pruned $(basename "$f")"
    done < <(ls -t -- "$DEST"/$kinds 2>/dev/null || true)
  done
  log "retention: $n file(s) pruned (older than ${RETAIN_DAYS} d, always keeping the newest ${MIN_KEEP} of each kind)"
}

dump_postgres
[ "$DO_REDIS" = 1 ] && snapshot_redis
if [ "$VERIFY_RESTORE" = 1 ]; then
  "$SELF_DIR/backup-restore-test.sh" "$PG_FILE" || fail "restore test of the new dump failed"
fi
[ "$DO_PRUNE" = 1 ] && prune_old
RESULT=OK; MESSAGE="ok${WARNINGS:+ (warnings: $WARNINGS)}"
log "backup finished OK in $(( $(date +%s) - STARTED )) s${WARNINGS:+; warnings: $WARNINGS}"
