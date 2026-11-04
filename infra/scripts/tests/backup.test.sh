#!/usr/bin/env bash
# Hermetic tests for infra/scripts/backup.sh: a stub `docker` stands in for PostgreSQL and Redis, so no real database, container or network is touched.
# Needs GNU coreutils/util-linux (flock, stat -c, df -P): run on Linux.   usage: bash infra/scripts/tests/backup.test.sh
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); SCRIPT=$HERE/../backup.sh
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; PASS=0; FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }; bad() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }
check() { local l=$1; shift; if "$@" >/dev/null 2>&1; then ok "$l"; else bad "$l"; fi; }
SECRET_PW=SENTINEL_REDIS_PASSWORD_9f3a; SECRET_SMTP=SENTINEL_SMTP_SECRET_77c1; ROW_DATA=SENTINEL_CUSTOMER_ROW_4be2

# ---- fixtures ---------------------------------------------------------------------------------------------------------------------------
FIXTURE=$T/fixture.sql
{ echo "-- PostgreSQL database dump"; echo "CREATE TABLE public.users (id integer, name text);"; echo "CREATE TABLE public.messages (id integer, body text);"; echo "CREATE TABLE public._prisma_migrations (id text);"
  printf 'COPY public.users (id, name) FROM stdin;\n1\t%s\n2\tbob\n\\.\n' "$ROW_DATA"
  printf 'COPY public.messages (id, body) FROM stdin;\n1\thello\n2\tworld\n3\tagain\n\\.\n'
  printf 'COPY public._prisma_migrations (id) FROM stdin;\nm1\nm2\n\\.\n'; echo "-- PostgreSQL database dump complete"; } > "$FIXTURE"
head -c 4096 /dev/urandom > "$T/rdb.fixture"
mkdir -p "$T/bin" "$T/state"
cat > "$T/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_STATE/argv.log"                 # every argument list the script ever passes to docker
cmd=$1; shift
case $cmd in
  exec)
    while [ "${1:-}" = -i ] || [ "${1:-}" = -e ]; do if [ "$1" = -e ]; then shift 2; else shift; fi; done
    ctr=$1; shift; prog=$1; shift
    case $prog in
      pg_isready) [ -z "${STUB_NOT_READY:-}" ];;
      pg_dump) if [ -n "${STUB_PG_FAIL_LATE:-}" ]; then cat "$FIXTURE"; exit 1
               elif [ -n "${STUB_PG_FAIL:-}" ]; then head -n 6 "$FIXTURE"; exit 1
               elif [ -n "${STUB_EMPTY:-}" ]; then exit 0
               elif [ -n "${STUB_TRUNCATE:-}" ]; then grep -v 'dump complete' "$FIXTURE"
               else cat "$FIXTURE"; fi;;
      psql) q=${*: -1}; case $q in *pg_tables*) echo "${STUB_TABLES:-3}";; *_prisma_migrations*) echo "${STUB_MIGS:-2}";; *) echo 0;; esac;;
      redis-cli) if [ -n "${STUB_REDIS_PASSWORD:-}" ] && [ "${REDISCLI_AUTH:-}" != "$STUB_REDIS_PASSWORD" ]; then echo "NOAUTH Authentication required."; exit 1; fi
                 case $1 in
                   PING) echo PONG;;
                   LASTSAVE) cat "$STUB_STATE/lastsave" 2>/dev/null || echo 100;;
                   BGSAVE) n=$(cat "$STUB_STATE/lastsave" 2>/dev/null || echo 100); [ -n "${STUB_BGSAVE_STUCK:-}" ] || echo $((n + 1)) > "$STUB_STATE/lastsave"; echo "Background saving started";;
                   INFO) echo "rdb_bgsave_in_progress:0";; esac;;
      sha256sum) printf '%s  /data/dump.rdb\n' "$(sha256sum "$RDB_FIXTURE" | cut -d' ' -f1)";;
      redis-check-rdb) echo "[offset 0] Checking RDB file /data/dump.rdb"; if [ -n "${STUB_RDB_BAD:-}" ]; then echo "Wrong signature"; exit 1; else echo '[offset 1855528] Checksum OK'; echo '[offset 1855528] \o/ RDB looks OK! \o/'; echo '[info] 1552 keys read'; echo '[info] 14 expires'; echo '[info] 14 already expired'; fi;;   # the verdict is NOT the last line, as in the real tool
    esac;;
  cp) dest=${2}; if [ -n "${STUB_RDB_CHANGES:-}" ]; then head -c 4096 /dev/urandom > "$dest"; else cp "$RDB_FIXTURE" "$dest"; fi;;
  inspect) echo postgres:16-alpine;;
  *) echo "stub docker: unsupported $cmd" >&2; exit 99;;
esac
STUB
chmod +x "$T/bin/docker"
cat > "$T/hostile.env" <<EOF
POSTGRES_USER=waplatform
POSTGRES_DB=waplatform
SMTP_PASS=pa ss word $SECRET_SMTP
TIKTOK_CLIENT_SECRET=a b \$(touch $T/pwned1) \`touch $T/pwned2\` ; touch $T/pwned3
REDIS_PASSWORD=
WEIRD="quoted value"
EOF
printf 'POSTGRES_USER=waplatform\nPOSTGRES_DB=waplatform\nREDIS_PASSWORD=%s\n' "$SECRET_PW" > "$T/redispw.env"
printf 'POSTGRES_USER=waplatform; rm -rf /tmp/x\nPOSTGRES_DB=waplatform\n' > "$T/badname.env"

run() { # run <dest> [env assignments...] -- [script args...]
  local dest=$1; shift; local envs=(); while [ "${1:-}" != "--" ]; do envs+=("$1"); shift; done; shift
  env PATH="$T/bin:$PATH" STUB_STATE="$T/state" FIXTURE="$FIXTURE" RDB_FIXTURE="$T/rdb.fixture" BACKUP_ENV_FILE="$T/hostile.env" "${envs[@]}" bash "$SCRIPT" --dest "$dest" "$@" > "$T/last.out" 2>&1
}
status() { sed -n "s/.*\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}\$/\1/p" "$2/.last-status.json" | head -1; }
newdest() { local d=$T/dest-$1; mkdir -p "$d"; echo "$d"; }
nofiles() { [ -z "$(ls -A "$1" 2>/dev/null | grep -E '^(postgres_|redis_|\.postgres_|\.redis_)' || true)" ]; }

echo "== T1 happy path (against a hostile .env)"
D=$(newdest t1); run "$D" -- ; rc=$?
check "exits 0" [ $rc = 0 ]
check "status file says OK" [ "$(status result "$D")" = OK ]
check "postgres dump present, 0600, with a matching .sha256" bash -c "f=\$(ls $D/postgres_*.sql.gz) && [ \"\$(stat -c %a \$f)\" = 600 ] && [ \"\$(stat -c %a \$f.sha256)\" = 600 ] && (cd $D && sha256sum -c --quiet \$(basename \$f).sha256)"
check "redis snapshot present, 0600, with a matching .sha256" bash -c "f=\$(ls $D/redis_*.rdb) && [ \"\$(stat -c %a \$f)\" = 600 ] && (cd $D && sha256sum -c --quiet \$(basename \$f).sha256)"
check "destination directory is 0700" [ "$(stat -c %a "$D")" = 700 ]
check "status records 3 tables and 2 migration rows" bash -c "[ \"\$(grep -o '\"postgres_tables\": [0-9]*' $D/.last-status.json | grep -o '[0-9]*\$')\" = 3 ] && [ \"\$(grep -o '\"postgres_migration_rows\": [0-9]*' $D/.last-status.json | grep -o '[0-9]*\$')\" = 2 ]"
check "no partial files left" bash -c "! ls -A $D | grep -q partial"
check "hostile .env executed nothing (no pwned files)" bash -c "[ ! -e $T/pwned1 ] && [ ! -e $T/pwned2 ] && [ ! -e $T/pwned3 ]"
check "log contains no secret from .env and no row data" bash -c "! grep -qE '$SECRET_SMTP|$SECRET_PW|$ROW_DATA' $T/last.out $D/.last-status.json"
check "freshness check passes right after a successful run" bash -c "env BACKUP_ENV_FILE=$T/hostile.env bash $SCRIPT --dest $D --check-freshness 1"

echo "== T2 the OLD weakness: pg_dump fails after printing part of a dump (exit 1)"
D=$(newdest t2); run "$D" STUB_PG_FAIL=1 -- ; rc=$?
check "exits non-zero" [ $rc != 0 ]; check "status says FAIL" [ "$(status result "$D")" = FAIL ]; check "no backup file and no partial left behind" nofiles "$D"
check "freshness check fails after a failed run" bash -c "! env BACKUP_ENV_FILE=$T/hostile.env bash $SCRIPT --dest $D --check-freshness 1"

echo "== T2b pg_dump emits a COMPLETE, valid-looking dump and then exits 1 (only the exit code can reveal this; the old script would call it a success)"
D=$(newdest t2b); run "$D" STUB_PG_FAIL_LATE=1 -- ; rc=$?
check "exits non-zero" [ $rc != 0 ]; check "no backup file kept" nofiles "$D"; check "the failure is attributed to pg_dump's exit code" grep -q "pg_dump/gzip failed" "$T/last.out"

echo "== T3 dump without the completion marker (truncated but exit 0)"
D=$(newdest t3); run "$D" STUB_TRUNCATE=1 -- ; rc=$?; check "exits non-zero and leaves no file" bash -c "[ $rc != 0 ] && [ -z \"\$(ls -A $D | grep -E '^(postgres_|\\.postgres_)')\" ]"; check "message names the marker" grep -q "completion marker\|marker" "$T/last.out"
echo "== T4 empty dump (exit 0, no output)"
D=$(newdest t4); run "$D" STUB_EMPTY=1 -- ; rc=$?; check "exits non-zero and leaves no file" bash -c "[ $rc != 0 ] && [ -z \"\$(ls -A $D | grep -E '^(postgres_|\\.postgres_)')\" ]"
echo "== T5 table count differs from the live database"
D=$(newdest t5); run "$D" STUB_TABLES=4 -- ; rc=$?; check "exits non-zero and leaves no file" bash -c "[ $rc != 0 ] && [ -z \"\$(ls -A $D | grep -E '^(postgres_|\\.postgres_)')\" ]"; check "message says 3 vs 4 tables" grep -q "3 tables but the database has 4" "$T/last.out"
echo "== T6 migration rows differ from the live database"
D=$(newdest t6); run "$D" STUB_MIGS=5 -- ; rc=$?; check "exits non-zero and leaves no file" bash -c "[ $rc != 0 ] && [ -z \"\$(ls -A $D | grep -E '^(postgres_|\\.postgres_)')\" ]"
echo "== T7 database not ready / disk too small"
D=$(newdest t7a); run "$D" STUB_NOT_READY=1 -- ; rc=$?; check "not-ready database is refused before any dump" bash -c "[ $rc != 0 ] && ! ls $D | grep -q postgres_ && grep -q 'not ready' $T/last.out"
D=$(newdest t7b); run "$D" MIN_FREE_MB=999999999 -- ; rc=$?; check "insufficient free space is refused" bash -c "[ $rc != 0 ] && grep -q 'MB free' $T/last.out"
echo "== T8 never overwrites an existing backup"
D=$(newdest t8); run "$D" BACKUP_TS=20260101_000000 -- ; echo "marker" > "$D/postgres_20260102_000000.sql.gz"; before=$(sha256sum "$D/postgres_20260102_000000.sql.gz" | cut -d' ' -f1)
run "$D" BACKUP_TS=20260102_000000 -- ; rc=$?; check "second run with a colliding name fails" [ $rc != 0 ]; check "the existing file is byte-identical" [ "$(sha256sum "$D/postgres_20260102_000000.sql.gz" | cut -d' ' -f1)" = "$before" ]
echo "== T9 only one run at a time"
D=$(newdest t9); ( exec 8> "$D/.backup.lock"; flock -n 8; sleep 4 ) & sleep 1
run "$D" -- ; rc=$?; check "a concurrent run is refused" bash -c "[ $rc != 0 ] && grep -q 'already running' $T/last.out"; wait
echo "== T10 hostile database name is rejected before anything runs"
D=$(newdest t10); run "$D" BACKUP_ENV_FILE="$T/badname.env" -- ; rc=$?; check "rejected" bash -c "[ $rc != 0 ] && grep -q 'unexpected characters' $T/last.out"; check "nothing was sent to docker" bash -c "! grep -q 'rm -rf' $T/state/argv.log"
echo "== T11 Redis: password never on a command line; BGSAVE that never completes; corrupted copy"
: > "$T/state/argv.log"; D=$(newdest t11a); run "$D" BACKUP_ENV_FILE="$T/redispw.env" -- ; rc=$?; check "run succeeds with a password configured that the server does not require" [ $rc = 0 ]
check "that mismatch is recorded as a warning" grep -q "accepts unauthenticated connections" "$D/.last-status.json"
rm -f "$T/state/lastsave"; D=$(newdest t11e); run "$D" BACKUP_ENV_FILE="$T/redispw.env" STUB_REDIS_PASSWORD=$SECRET_PW -- ; rc=$?; check "run succeeds when the server DOES require the configured password" [ $rc = 0 ]
check "the password appears in NO docker argument list (either case)" bash -c "! grep -q $SECRET_PW $T/state/argv.log"
D=$(newdest t11b); run "$D" STUB_BGSAVE_STUCK=1 REDIS_WAIT_S=3 -- ; check "a BGSAVE that never finishes fails the run" bash -c "[ \"\$(grep -c 'did not finish' $T/last.out)\" -ge 1 ]"; check "the (valid) PostgreSQL backup is still kept and the run is reported as failed" bash -c "ls $D/postgres_*.sql.gz >/dev/null && [ \"\$(grep -o '\"result\": \"[A-Z]*\"' $D/.last-status.json)\" = '\"result\": \"FAIL\"' ]"
rm -f "$T/state/lastsave"; D=$(newdest t11c); run "$D" STUB_RDB_CHANGES=1 -- ; check "a Redis copy that does not match the source is rejected" bash -c "grep -q 'changed or was corrupted' $T/last.out && ! ls $D | grep -q '^redis_'"
rm -f "$T/state/lastsave"; D=$(newdest t11d); run "$D" STUB_RDB_BAD=1 -- ; check "redis-check-rdb rejection fails the run" bash -c "grep -q 'redis-check-rdb' $T/last.out"
rm -f "$T/state/lastsave"

echo "== T12 retention is opt-in, keeps the newest MIN_KEEP, and ignores files it did not create"
D=$(newdest t12); for i in 01 02 03 04 05 06 07 08 09 10; do f=$D/postgres_202601${i}_000000.sql.gz; echo x > $f; echo "h  $(basename $f)" > $f.sha256; touch -d "2026-01-$i" $f; done
echo y > "$D/postgres_20250101_000000.sql.gz"; touch -d 2025-01-01 "$D/postgres_20250101_000000.sql.gz"   # old, no sidecar: not ours
echo z > "$D/notes.txt"; touch -d 2020-01-01 "$D/notes.txt"
run "$D" BACKUP_TS=20260301_000000 RETAIN_DAYS=7 MIN_KEEP=4 -- ; check "without --prune nothing is deleted" bash -c "[ \$(ls $D/postgres_2026*.sql.gz | wc -l) = 11 ]"
run "$D" BACKUP_TS=20260302_000000 RETAIN_DAYS=7 MIN_KEEP=4 -- --prune ; check "with --prune the newest 4 are kept" bash -c "[ \$(ls $D/postgres_2026*.sql.gz | wc -l) -ge 4 ] && ls $D/postgres_20260302_000000.sql.gz >/dev/null && ls $D/postgres_20260301_000000.sql.gz >/dev/null"
check "a file without a .sha256 sidecar and an unrelated file are NOT deleted" bash -c "ls $D/postgres_20250101_000000.sql.gz $D/notes.txt >/dev/null"
check "old validated files beyond the newest 4 were pruned" bash -c "[ ! -e $D/postgres_20260101_000000.sql.gz ] && [ ! -e $D/postgres_20260101_000000.sql.gz.sha256 ]"

echo "== T13 permissions of a pre-existing destination are tightened, not widened"
D=$T/dest-t13; mkdir -m 755 "$D"; run "$D" -- ; check "directory is 0700 after the run" [ "$(stat -c %a "$D")" = 700 ]
echo "== T14 --check-freshness with no status file"
D=$(newdest t14); check "fails when nothing was ever backed up" bash -c "! env BACKUP_ENV_FILE=$T/hostile.env bash $SCRIPT --dest $D --check-freshness 24"

echo "BACKUP TESTS: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
