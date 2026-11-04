#!/usr/bin/env bash
# Restore a PostgreSQL dump into a THROWAWAY database and prove it is complete. Production is never read or written.
#   backup-restore-test.sh <postgres_*.sql.gz> [--keep-report DIR]
# The throwaway server runs the same image as the production database, with NO network (no iptables/Docker network changes), PGDATA on tmpfs, a memory cap,
# a label and an EXIT trap that always removes it. The comparison is against the dump itself (exact per-table COPY row counts, table list, migrations),
# so it needs no access to production. Output contains table names and counts only, never row data.
set -Eeuo pipefail
umask 077
DUMP=${1:?usage: backup-restore-test.sh <dump.sql.gz>}; shift || true
REPORT_DIR=; while [ $# -gt 0 ]; do case $1 in --keep-report) REPORT_DIR=${2:?}; shift 2;; *) echo "unknown option $1" >&2; exit 2;; esac; done
PG_CONTAINER=${PG_CONTAINER:-wa_postgres}; PGUSER=${RESTORE_PGUSER:-${POSTGRES_USER:-waplatform}}; PGDB=${RESTORE_PGDB:-${POSTGRES_DB:-waplatform}}
IMAGE=${RESTORE_IMAGE:-$(docker inspect -f '{{.Config.Image}}' "$PG_CONTAINER")}
TMPFS_MB=${RESTORE_TMPFS_MB:-4096}; MEM=${RESTORE_MEM:-4g}; WAIT_S=${RESTORE_WAIT_S:-90}
NAME=verz-restore-test-$$; LABEL=verz.backup-restore-test=1
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
[ -r "$DUMP" ] || { echo "cannot read $DUMP" >&2; exit 2; }
[[ $PGUSER =~ ^[A-Za-z0-9_]+$ ]] && [[ $PGDB =~ ^[A-Za-z0-9_]+$ ]] || { echo "unexpected database/user name" >&2; exit 2; }
if [ -f "$DUMP.sha256" ]; then (cd "$(dirname "$DUMP")" && sha256sum -c --quiet "$(basename "$DUMP").sha256") || { echo "FAIL  sha256 sidecar does not match the dump" >&2; exit 1; }; log "sha256 sidecar matches"; fi
gzip -t -- "$DUMP" || { echo "FAIL  not a valid gzip" >&2; exit 1; }
[ -z "$(docker ps -aq --filter "label=$LABEL")" ] || { echo "FAIL  another restore-test container exists; refusing to run two" >&2; exit 1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f "${WORK:-/nonexistent}"/* 2>/dev/null || true; [ -n "${WORK:-}" ] && rmdir "$WORK" 2>/dev/null || true; }
trap cleanup EXIT
WORK=$(mktemp -d); PW=$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)
docker run -d --name "$NAME" --label "$LABEL" --network none --restart no --memory "$MEM" --cpus 2 --tmpfs "/var/lib/postgresql/data:rw,size=${TMPFS_MB}m" \
  -e POSTGRES_USER="$PGUSER" -e POSTGRES_DB="$PGDB" -e POSTGRES_PASSWORD="$PW" "$IMAGE" >/dev/null
for i in $(seq 1 "$WAIT_S"); do [ "$(docker logs "$NAME" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] && break; sleep 1; done
[ "$(docker logs "$NAME" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] || { echo "FAIL  throwaway postgres did not become ready" >&2; exit 1; }
t0=$(date +%s)
if ! gzip -dc -- "$DUMP" | docker exec -i "$NAME" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -q -o /dev/null 2> "$WORK/restore.err"; then
  echo "FAIL  restore returned an error:" >&2; head -5 "$WORK/restore.err" | cut -c1-200 >&2; exit 1; fi
[ ! -s "$WORK/restore.err" ] || { echo "FAIL  restore printed warnings/errors:" >&2; head -5 "$WORK/restore.err" | cut -c1-200 >&2; exit 1; }
log "restore finished in $(( $(date +%s) - t0 )) s"

PASS=0; FAILN=0; ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }; bad() { echo "FAIL  $1"; FAILN=$((FAILN + 1)); }
rpsql() { docker exec "$NAME" psql -U "$PGUSER" -d "$PGDB" -Atc "$1"; }
COUNTS="select table_schema||'.'||table_name||'='||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE' order by 1"
gzip -dc -- "$DUMP" | awk '/^COPY /{t=$2; gsub(/"/,"",t); n=0; f=1; next} f&&/^\\\.$/{print t "=" n; f=0; next} f{n++}' | sort > "$WORK/dump.counts"
rpsql "$COUNTS" | sort > "$WORK/restored.counts"
dt=$(gzip -dc -- "$DUMP" | grep -c '^CREATE TABLE ' || true); rt=$(wc -l < "$WORK/restored.counts" | tr -d ' ')
[ "$dt" = "$rt" ] && [ "$dt" -ge 1 ] && ok "table count: $dt in the dump, $rt restored" || bad "table count: $dt in the dump, $rt restored"
if diff -q "$WORK/dump.counts" "$WORK/restored.counts" >/dev/null; then ok "exact row counts equal for all $(wc -l < "$WORK/dump.counts" | tr -d ' ') tables ($(awk -F= '{s+=$2} END{print s+0}' "$WORK/restored.counts") rows in total)"
else bad "row counts differ from the dump for: $(diff "$WORK/dump.counts" "$WORK/restored.counts" | grep '^[<>]' | sed 's/^[<>] //; s/=.*//' | sort -u | head -8 | tr '\n' ' ')"; fi
if grep -q '_prisma_migrations=' "$WORK/restored.counts"; then
  m=$(rpsql 'select count(*) from _prisma_migrations'); [ "$m" -ge 1 ] && ok "migrations restored: $m rows, last applied '$(rpsql "select migration_name from _prisma_migrations order by finished_at desc nulls last, started_at desc limit 1")'" || bad "no migration rows restored"
  # Prisma marks a migration that was deliberately resolved as rolled back with rolled_back_at; a FAILED migration has neither finished_at nor rolled_back_at
  [ "$(rpsql 'select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null')" = 0 ] && ok "no failed (unfinished and not rolled back) migrations in the restored copy; $(rpsql 'select count(*) from _prisma_migrations where rolled_back_at is not null') resolved as rolled back" || bad "failed migrations present in the restored copy"
fi
big=$(sort -t= -k2 -n -r "$WORK/restored.counts" | head -1); [ "${big#*=}" -gt 0 ] && ok "largest table has rows (${big%%=*}: ${big#*=})" || bad "largest table is empty"
[ "$(rpsql "select count(*) from pg_indexes where schemaname not in ('pg_catalog','information_schema')")" -ge 1 ] && ok "indexes restored" || bad "no indexes restored"
log "info: $(rpsql 'select count(*) from pg_constraint where contype=$$f$$') foreign keys, $(rpsql "select count(*) from pg_indexes where schemaname not in ('pg_catalog','information_schema')") indexes in the restored copy"
[ -z "$REPORT_DIR" ] || { mkdir -p "$REPORT_DIR"; cp "$WORK/dump.counts" "$REPORT_DIR/dump.counts"; cp "$WORK/restored.counts" "$REPORT_DIR/restored.counts"; }
echo "RESTORE-TEST: $PASS pass, $FAILN fail"; [ "$FAILN" = 0 ]
