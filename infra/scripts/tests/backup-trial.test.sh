#!/usr/bin/env bash
# Hermetic tests for backup-trial/run.sh and check.sh (no docker, no real backups). Needs GNU coreutils: run on Linux.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); TR=$HERE/../backup-trial; BK=$HERE/../backup.sh
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; PASS=0; FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }; bad() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }; check() { local l=$1; shift; if "$@" >/dev/null 2>&1; then ok "$l"; else bad "$l"; fi; }
mkdir -p "$T/base"; cp "$BK" "$T/base/backup.sh"; cp "$HERE/../backup-restore-test.sh" "$T/base/"; cp "$TR/notify.sh" "$T/base/"; chmod +x "$T/base/"*.sh
export TRIAL_BASE=$T/base TRIAL_STATE=$T/state TRIAL_LOG=$T/run.log BACKUP_DEST=$T/dest OLD_BACKUP_DIR=$T/old OLD_SCRIPT=$T/old-script.sh OLD_CRON_D=$T/old-cron NOTIFY_CAPTURE=$T/alerts.txt MIN_FREE_MB=1
mkdir -p "$T/stubbin"; printf '#!/bin/bash\ncat "%s/crontab.txt"\n' "$T" > "$T/stubbin/crontab"; chmod +x "$T/stubbin/crontab"; printf '# comment\n0 2 * * * /root/backup-postgres.sh\n' > "$T/crontab.txt"; export PATH="$T/stubbin:$PATH"
# the status file backup.sh writes, with the counts it validated against the live database
status() { # status <result> <finished_epoch> [tables] [migs] [warnings]
  printf '{\n  "result": "%s",\n  "message": "ok",\n  "finished_epoch": %s,\n  "postgres_tables": %s,\n  "postgres_migration_rows": %s,\n  "warnings": "%s"\n}\n' "$1" "$2" "${3:-105}" "${4:-100}" "${5:-}" > "$T/dest/.last-status.json"; }
echo "== run.sh"
printf '#!/bin/bash\nexit 0\n' > "$T/ok.sh"; printf '#!/bin/bash\necho "boom (no secret here)"; exit 3\n' > "$T/fail.sh"; chmod +x "$T/ok.sh" "$T/fail.sh"
BACKUP_CMD=$T/ok.sh bash "$TR/run.sh"; rc=$?; check "success: exit 0, no alert, run recorded" bash -c "[ $rc = 0 ] && [ ! -s '$T/alerts.txt' ] && grep -q 'rc=0' '$T/state/runs.log'"
BACKUP_CMD=$T/fail.sh bash "$TR/run.sh"; rc=$?; check "failure: exit code propagated (3), alert sent, log kept" bash -c "[ $rc = 3 ] && grep -q 'FAILED (exit 3)' '$T/alerts.txt' && grep -q boom '$T/run.log'"
check "log is mode 600" bash -c "[ \"\$(stat -c %a '$T/run.log')\" = 600 ]"
echo "== check.sh"
mkdir -p "$T/dest" "$T/old"; chmod 700 "$T/dest"; : > "$T/alerts.txt"
mk() { # mk <name> <bytes>: a valid gzip of that size class + sidecar
  head -c "$2" /dev/zero | tr '\0' 'a' | gzip > "$T/dest/$1"; chmod 600 "$T/dest/$1"; (cd "$T/dest" && sha256sum "$1" > "$1.sha256"); chmod 600 "$T/dest/$1.sha256"; }
mk postgres_20260101_000000.sql.gz 100000; sleep 1; mk postgres_20260102_000000.sql.gz 100000; head -c 2000 /dev/urandom > "$T/dest/redis_20260102_000000.rdb"; chmod 600 "$T/dest/redis_20260102_000000.rdb"; (cd "$T/dest" && sha256sum redis_20260102_000000.rdb > redis_20260102_000000.rdb.sha256; chmod 600 redis_20260102_000000.rdb.sha256)
status OK "$(date +%s)"
head -c 100000 /dev/zero | tr '\0' 'a' | gzip > "$T/old/waplatform_20260102_020001.sql.gz"; echo old > "$T/old-script.sh"; echo cron > "$T/old-cron"
printf '=== %s trial run start; backup.sh sha256 x\n[%s] sha256 sidecar matches\nPASS  table count: 105\nRESTORE-TEST: 6 pass, 0 fail\n[%s] backup finished OK\n=== %s trial run end rc=0\n' "$(date '+%F %T')" "$(date '+%F %T')" "$(date '+%F %T')" "$(date '+%F %T')" > "$T/run.log"
bash "$TR/check.sh" > "$T/c1.out" 2>&1; check "baseline run: recorded the existing job's hashes" test -s "$T/state/old-job-baseline.sha256"
bash "$TR/check.sh" > "$T/c2.out" 2>&1; rc=$?; check "healthy trial passes every check (exit 0, no alert)" bash -c "[ $rc = 0 ] && [ ! -s '$T/alerts.txt' ] && grep -q 'CHECK: 0 failure' '$T/c2.out'"; grep -E '^FAIL' "$T/c2.out" | sed 's/^/      /'; true
chmod 644 "$T/dest/postgres_20260102_000000.sql.gz"; bash "$TR/check.sh" > "$T/c3.out" 2>&1; rc=$?; check "mode 644 on a backup is a FAIL and alerts" bash -c "[ $rc = 1 ] && grep -q 'mode 600' '$T/c3.out' && grep -q 'FAILED' '$T/alerts.txt'"; chmod 600 "$T/dest/postgres_20260102_000000.sql.gz"; : > "$T/alerts.txt"
printf 'xxxxxxxx' >> "$T/dest/postgres_20260102_000000.sql.gz"; bash "$TR/check.sh" > "$T/c4.out" 2>&1; rc=$?; check "a modified/corrupt backup is a FAIL (gzip and sha256)" bash -c "[ $rc = 1 ] && grep -q 'sha256 sidecar matches' '$T/c4.out'"; mk postgres_20260102_000000.sql.gz 100000; : > "$T/alerts.txt"
status OK "$(( $(date +%s) - 40 * 3600 ))"; bash "$TR/check.sh" > "$T/c5.out" 2>&1; rc=$?; check "a stale status (40 h) is a FAIL" bash -c "[ $rc = 1 ] && grep -q 'FAIL  new job: last run succeeded' '$T/c5.out'"
status FAIL "$(date +%s)"; bash "$TR/check.sh" > "$T/c6.out" 2>&1; rc=$?; check "a FAIL status is a FAIL" [ $rc = 1 ]
status OK "$(date +%s)"; : > "$T/alerts.txt"
echo tampered >> "$T/old-script.sh"; bash "$TR/check.sh" > "$T/c7.out" 2>&1; rc=$?; check "any change to the existing job's script is detected and alerts" bash -c "[ $rc = 1 ] && grep -q 'UNCHANGED' '$T/c7.out' && [ -s '$T/alerts.txt' ]"; echo old > "$T/old-script.sh"
printf '# only a new comment\n0 2 * * * /root/backup-postgres.sh\n' > "$T/crontab.txt"; : > "$T/alerts.txt"; bash "$TR/check.sh" > "$T/c7b.out" 2>&1; rc=$?; check "a comment-only crontab edit is NOT a change" [ $rc = 0 ]
printf '# comment\n0 3 * * * /root/backup-postgres.sh\n' > "$T/crontab.txt"; bash "$TR/check.sh" > "$T/c7c.out" 2>&1; rc=$?; check "changing the existing job's schedule in the root crontab is detected and alerts" bash -c "[ $rc = 1 ] && grep -q 'root crontab' '$T/c7c.out' && [ -s '$T/alerts.txt' ]"; printf '# comment\n0 2 * * * /root/backup-postgres.sh\n' > "$T/crontab.txt"
printf '=== %s trial run start; x\nRESTORE-TEST: 2 pass, 1 fail\n=== %s trial run end rc=1\n' "$(date '+%F %T')" "$(date '+%F %T')" > "$T/run.log"; bash "$TR/check.sh" > "$T/c8.out" 2>&1; rc=$?; check "no passing restore test today is a FAIL" [ $rc = 1 ]
printf '=== 2020-01-01 00:00:00 trial run start; x\nRESTORE-TEST: 6 pass, 0 fail\n' > "$T/run.log"; bash "$TR/check.sh" > "$T/c8b.out" 2>&1; rc=$?; check "a passing restore test from an earlier day does not count" [ $rc = 1 ]
printf '=== %s trial run start; x\nRESTORE-TEST: 6 pass, 0 fail\n=== %s trial run end rc=0\n=== %s trial run start; y\n(second run today died before its restore test)\n' "$(date '+%F %T')" "$(date '+%F %T')" "$(date '+%F %T')" > "$T/run.log"; bash "$TR/check.sh" > "$T/c8c.out" 2>&1; rc=$?; check "if the LATEST run today has no passing restore test, an earlier run's pass does not count" [ $rc = 1 ]
printf '=== %s trial run start; x\nRESTORE-TEST: 6 pass, 0 fail\n' "$(date '+%F %T')" > "$T/run.log"
rm -f "$T/old/"*; bash "$TR/check.sh" > "$T/c9.out" 2>&1; rc=$?; check "a missing dump from the EXISTING job is a FAIL too" bash -c "[ $rc = 1 ] && grep -q 'existing 02:00 job' '$T/c9.out'"
echo "== scheduled-run presence (from the second day)"
printf '=== %s trial run start; x\nRESTORE-TEST: 6 pass, 0 fail\n' "$(date '+%F %T')" > "$T/run.log"; : > "$T/alerts.txt"; mk_old() { head -c 100000 /dev/zero | tr '\0' 'a' | gzip > "$T/old/waplatform_20260102_020001.sql.gz"; }; mk_old
status OK "$(date +%s)"
date +%F > "$T/state/trial-start-date"; echo "$(date +%s) x rc=0" > "$T/state/runs.log"; bash "$TR/check.sh" > "$T/d1.out" 2>&1; rc=$?; check "install day: a manual run is enough (no scheduled-run requirement yet)" [ $rc = 0 ]
date -d 'yesterday' +%F > "$T/state/trial-start-date"; echo "$(date -d 'today 01:00' +%s) x rc=0" > "$T/state/runs.log"; bash "$TR/check.sh" > "$T/d2.out" 2>&1; rc=$?; check "later day: a run recorded before 02:25 today does NOT satisfy the schedule check" bash -c "[ $rc = 1 ] && grep -q 'FAIL  new job: the 02:30 scheduled run' '$T/d2.out'"
echo "$(date -d 'today 02:31' +%s) x rc=0" > "$T/state/runs.log"; bash "$TR/check.sh" > "$T/d3.out" 2>&1; rc=$?; check "later day: a run recorded at 02:31 satisfies it" bash -c "grep -q 'PASS  new job: the 02:30 scheduled run' '$T/d3.out'"
echo "== counts, retention, off-host, heartbeat, record, summary"
# a clean slate for these scenarios
rm -f "$T/dest"/*; chmod 700 "$T/dest"; mk postgres_20260102_000000.sql.gz 100000; head -c 2000 /dev/urandom > "$T/dest/redis_20260102_000000.rdb"; chmod 600 "$T/dest/redis_20260102_000000.rdb"; (cd "$T/dest" && sha256sum redis_20260102_000000.rdb > redis_20260102_000000.rdb.sha256; chmod 600 redis_20260102_000000.rdb.sha256)
mk_old; status OK "$(date +%s)"; printf '=== %s trial run start; x\nRESTORE-TEST: 6 pass, 0 fail\n=== %s trial run end rc=0\n' "$(date '+%F %T')" "$(date '+%F %T')" > "$T/run.log"; : > "$T/alerts.txt"; rm -f "$T/state/ledger.tsv" "$T/state/trial-record.md"
date +%F > "$T/state/trial-start-date"
export OFFHOST_APPROVAL=$T/no-such-approval OFFHOST_STATE=$T/offstate
bash "$TR/check.sh" > "$T/e1.out" 2>&1; rc=$?; check "healthy: passes, including the counts and retention checks" bash -c "[ $rc = 0 ] && grep -q 'PASS  new job: its own status records a table count' '$T/e1.out' && grep -q 'PASS  retention: 1 PostgreSQL' '$T/e1.out'"
check "the ledger records tables, migrations and the restore result" bash -c "grep -q 'tables=105' '$T/state/ledger.tsv' && grep -q 'migs=100' '$T/state/ledger.tsv' && grep -q 'restore=6 pass, 0 fail' '$T/state/ledger.tsv'"
check "off-host: with no approved destination it is reported as INFO and is not a failure" bash -c "grep -q 'INFO  off-host: no approved destination' '$T/e1.out' && ! grep -q 'FAIL  off-host' '$T/e1.out'"
check "a human-readable record row is written for the day" bash -c "grep -q '| PASS | postgres_20260102_000000.sql.gz | ' '$T/state/trial-record.md' && head -1 '$T/state/trial-record.md' | grep -q 'Restore test'"
status OK "$(date +%s)" 105 99; bash "$TR/check.sh" > "$T/e2.out" 2>&1; rc=$?; check "counts: a migration count that FALLS since the last check is a FAIL and alerts" bash -c "[ $rc = 1 ] && grep -q 'FAIL  counts: migration rows did not fall since the last check (100 -> 99)' '$T/e2.out' && [ -s '$T/alerts.txt' ]"; : > "$T/alerts.txt"
status OK "$(date +%s)" 104 100; bash "$TR/check.sh" > "$T/e3.out" 2>&1; rc=$?; check "counts: a table count that falls is a FAIL" bash -c "[ $rc = 1 ] && grep -q 'FAIL  counts: tables did not fall' '$T/e3.out'"; : > "$T/alerts.txt"
status OK "$(date +%s)" 106 101; bash "$TR/check.sh" > "$T/e3b.out" 2>&1; rc=$?; check "counts: growth after a deploy is fine" [ $rc = 0 ]
status OK "$(date +%s)" 0 0; bash "$TR/check.sh" > "$T/e4.out" 2>&1; rc=$?; check "counts: a status with no table or migration count is a FAIL" bash -c "[ $rc = 1 ] && grep -q 'FAIL  new job: its own status records a table count' '$T/e4.out'"; : > "$T/alerts.txt"
status OK "$(date +%s)" 106 101 "size is 70% of the previous backup"; bash "$TR/check.sh" > "$T/e5.out" 2>&1; rc=$?; check "warnings the backup recorded are shown (WARN) without failing the day" bash -c "[ $rc = 0 ] && grep -q 'WARN  new job recorded warnings: size is 70%' '$T/e5.out'"
status OK "$(date +%s)"
for i in $(seq 3 20); do mk "postgres_202601$(printf %02d $i)_000000.sql.gz" 100000; done
bash "$TR/check.sh" > "$T/e6.out" 2>&1; rc=$?; check "retention: more backups than the limit means pruning is not working (FAIL)" bash -c "[ $rc = 1 ] && grep -q 'FAIL  retention: 19 PostgreSQL backups kept (limit 17' '$T/e6.out'"
RETAIN_DAYS=30 bash "$TR/check.sh" > "$T/e6b.out" 2>&1; rc=$?; check "retention: the limit follows RETAIN_DAYS" bash -c "grep -q 'PASS  retention: 19 PostgreSQL backups kept (limit 33' '$T/e6b.out'"
rm -f "$T/dest"/postgres_202601{03..20}_000000.sql.gz*; : > "$T/alerts.txt"
rm -f "$T/dest/postgres_20260102_000000.sql.gz.sha256"; bash "$TR/check.sh" > "$T/e7.out" 2>&1; rc=$?; check "retention: a backup without its sha256 sidecar is a FAIL" bash -c "[ $rc = 1 ] && grep -q 'FAIL  retention: every backup has its sha256 sidecar' '$T/e7.out'"; (cd "$T/dest" && sha256sum postgres_20260102_000000.sql.gz > postgres_20260102_000000.sql.gz.sha256; chmod 600 postgres_20260102_000000.sql.gz.sha256)
echo x > "$T/dest/postgres_20250101_000000.sql.gz.sha256"; bash "$TR/check.sh" > "$T/e8.out" 2>&1; rc=$?; check "retention: an orphaned sidecar is a FAIL" bash -c "[ $rc = 1 ] && grep -q 'FAIL  retention: every backup has its sha256 sidecar' '$T/e8.out'"; rm -f "$T/dest/postgres_20250101_000000.sql.gz.sha256"
touch "$T/dest/x.partial"; touch -d '3 days ago' "$T/dest/x.partial"; bash "$TR/check.sh" > "$T/e9.out" 2>&1; rc=$?; check "retention: a stale partial file is a FAIL" bash -c "[ $rc = 1 ] && grep -q 'FAIL  retention: no stale partial' '$T/e9.out'"; rm -f "$T/dest/x.partial"; : > "$T/alerts.txt"
# off-host once approved
echo "REMOTE=x" > "$T/approval.conf"; export OFFHOST_APPROVAL=$T/approval.conf; cp "$HERE/../offhost-backup.sh" "$T/base/offhost-backup.sh"; chmod +x "$T/base/offhost-backup.sh"
bash "$TR/check.sh" > "$T/f1.out" 2>&1; rc=$?; check "off-host: once a destination is approved, a missing upload is a FAIL and alerts" bash -c "[ $rc = 1 ] && grep -q 'FAIL  off-host: the last encrypted upload succeeded' '$T/f1.out' && [ -s '$T/alerts.txt' ]"; : > "$T/alerts.txt"
mkdir -p "$T/offstate"; printf '{\n  "result": "OK",\n  "finished_epoch": %s\n}\n' "$(date +%s)" > "$T/offstate/last-offhost.json"
bash "$TR/check.sh" > "$T/f2.out" 2>&1; rc=$?; check "off-host: a fresh successful upload passes" bash -c "[ $rc = 0 ] && grep -q 'PASS  off-host' '$T/f2.out'"
printf '{\n  "result": "OK",\n  "finished_epoch": %s\n}\n' "$(( $(date +%s) - 40 * 3600 ))" > "$T/offstate/last-offhost.json"
bash "$TR/check.sh" > "$T/f3.out" 2>&1; rc=$?; check "off-host: a 40 h old upload is a FAIL" [ $rc = 1 ]; : > "$T/alerts.txt"; export OFFHOST_APPROVAL=$T/no-such-approval
# dead-man heartbeat
printf '#!/bin/bash\necho "$*" >> "%s/curl.log"\n' "$T" > "$T/stubbin/curl"; chmod +x "$T/stubbin/curl"; : > "$T/curl.log"
bash "$TR/check.sh" > "$T/g1.out" 2>&1; check "heartbeat: nothing is sent when no URL is configured" bash -c "[ ! -s '$T/curl.log' ]"
DEADMAN_PING_URL=https://hc.example/ping/abc bash "$TR/check.sh" > "$T/g2.out" 2>&1; check "heartbeat: a passing day pings the URL (data-free GET)" bash -c "grep -q 'https://hc.example/ping/abc' '$T/curl.log' && ! grep -q -- '-d\|--data' '$T/curl.log'"
: > "$T/curl.log"; printf 'x' >> "$T/dest/postgres_20260102_000000.sql.gz"; DEADMAN_PING_URL=https://hc.example/ping/abc bash "$TR/check.sh" > "$T/g3.out" 2>&1; check "heartbeat: a FAILING day does not ping (so the silence raises the alarm)" bash -c "[ ! -s '$T/curl.log' ]"; mk postgres_20260102_000000.sql.gz 100000; : > "$T/alerts.txt"
# end-of-trial summary
SUMM=$TR/trial-summary.sh
rm -f "$T/state/ledger.tsv"; bash "$SUMM" > "$T/s0.out" 2>&1; rc=$?; check "summary: with no ledger it says the monitor has not run" bash -c "[ $rc = 1 ] && grep -q 'monitor has not run' '$T/s0.out'"
for d in 1 2 3 4 5 6; do printf '2026-11-0%s 08:15:01\thost\tfails=0\tnew=p 100\told=o 100\ttables=105\tmigs=100\trestore=6 pass, 0 fail\n' "$d" >> "$T/state/ledger.tsv"; done
bash "$SUMM" > "$T/s1.out" 2>&1; rc=$?; check "summary: six clean days is NOT ready" bash -c "[ $rc = 1 ] && grep -q 'VERDICT: NOT READY (days=6' '$T/s1.out'"
printf '2026-11-07 08:15:01\thost\tfails=0\tnew=p 100\told=o 100\ttables=105\tmigs=100\trestore=6 pass, 0 fail\n' >> "$T/state/ledger.tsv"
bash "$SUMM" > "$T/s2.out" 2>&1; rc=$?; check "summary: seven clean days with restore tests is READY FOR A DECISION, and says nothing was changed" bash -c "[ $rc = 0 ] && grep -q 'READY FOR A DECISION (nothing has been retired' '$T/s2.out'"
printf '2026-11-08 08:15:01\thost\tfails=1\tnew=p 100\told=o 100\ttables=105\tmigs=100\trestore=6 pass, 0 fail\n' >> "$T/state/ledger.tsv"
bash "$SUMM" > "$T/s3.out" 2>&1; rc=$?; check "summary: a failure inside the last seven checks blocks it" bash -c "[ $rc = 1 ] && grep -q 'NOT READY' '$T/s3.out'"
sed -i 's/restore=6 pass, 0 fail/restore=none/' "$T/state/ledger.tsv"; printf '2026-11-09 08:15:01\thost\tfails=0\tnew=p 100\told=o 100\ttables=105\tmigs=100\trestore=none\n' >> "$T/state/ledger.tsv"
bash "$SUMM" > "$T/s4.out" 2>&1; rc=$?; check "summary: days without a passing restore test do not count" [ $rc = 1 ]
echo "BACKUP TRIAL TESTS: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
