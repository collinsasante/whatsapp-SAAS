#!/usr/bin/env bash
# Hermetic tests for backup-trial/run.sh and check.sh (no docker, no real backups). Needs GNU coreutils: run on Linux.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); TR=$HERE/../backup-trial; BK=$HERE/../backup.sh
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; PASS=0; FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }; bad() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }; check() { local l=$1; shift; if "$@" >/dev/null 2>&1; then ok "$l"; else bad "$l"; fi; }
mkdir -p "$T/base"; cp "$BK" "$T/base/backup.sh"; cp "$HERE/../backup-restore-test.sh" "$T/base/"; cp "$TR/notify.sh" "$T/base/"; chmod +x "$T/base/"*.sh
export TRIAL_BASE=$T/base TRIAL_STATE=$T/state TRIAL_LOG=$T/run.log BACKUP_DEST=$T/dest OLD_BACKUP_DIR=$T/old OLD_SCRIPT=$T/old-script.sh OLD_CRON_D=$T/old-cron NOTIFY_CAPTURE=$T/alerts.txt MIN_FREE_MB=1
mkdir -p "$T/stubbin"; printf '#!/bin/bash\ncat "%s/crontab.txt"\n' "$T" > "$T/stubbin/crontab"; chmod +x "$T/stubbin/crontab"; printf '# comment\n0 2 * * * /root/backup-postgres.sh\n' > "$T/crontab.txt"; export PATH="$T/stubbin:$PATH"
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
printf '{\n  "result": "OK",\n  "finished_epoch": %s\n}\n' "$(date +%s)" > "$T/dest/.last-status.json"
head -c 100000 /dev/zero | tr '\0' 'a' | gzip > "$T/old/waplatform_20260102_020001.sql.gz"; echo old > "$T/old-script.sh"; echo cron > "$T/old-cron"
printf '=== %s trial run start; backup.sh sha256 x\n[%s] sha256 sidecar matches\nPASS  table count: 105\nRESTORE-TEST: 6 pass, 0 fail\n[%s] backup finished OK\n=== %s trial run end rc=0\n' "$(date '+%F %T')" "$(date '+%F %T')" "$(date '+%F %T')" "$(date '+%F %T')" > "$T/run.log"
bash "$TR/check.sh" > "$T/c1.out" 2>&1; check "baseline run: recorded the existing job's hashes" test -s "$T/state/old-job-baseline.sha256"
bash "$TR/check.sh" > "$T/c2.out" 2>&1; rc=$?; check "healthy trial passes every check (exit 0, no alert)" bash -c "[ $rc = 0 ] && [ ! -s '$T/alerts.txt' ] && grep -q 'CHECK: 0 failure' '$T/c2.out'"; grep -E '^FAIL' "$T/c2.out" | sed 's/^/      /'; true
chmod 644 "$T/dest/postgres_20260102_000000.sql.gz"; bash "$TR/check.sh" > "$T/c3.out" 2>&1; rc=$?; check "mode 644 on a backup is a FAIL and alerts" bash -c "[ $rc = 1 ] && grep -q 'mode 600' '$T/c3.out' && grep -q 'FAILED' '$T/alerts.txt'"; chmod 600 "$T/dest/postgres_20260102_000000.sql.gz"; : > "$T/alerts.txt"
printf 'xxxxxxxx' >> "$T/dest/postgres_20260102_000000.sql.gz"; bash "$TR/check.sh" > "$T/c4.out" 2>&1; rc=$?; check "a modified/corrupt backup is a FAIL (gzip and sha256)" bash -c "[ $rc = 1 ] && grep -q 'sha256 sidecar matches' '$T/c4.out'"; mk postgres_20260102_000000.sql.gz 100000; : > "$T/alerts.txt"
printf '{\n  "result": "OK",\n  "finished_epoch": %s\n}\n' "$(( $(date +%s) - 40 * 3600 ))" > "$T/dest/.last-status.json"; bash "$TR/check.sh" > "$T/c5.out" 2>&1; rc=$?; check "a stale status (40 h) is a FAIL" bash -c "[ $rc = 1 ] && grep -q 'FAIL  new job: last run succeeded' '$T/c5.out'"
printf '{\n  "result": "FAIL",\n  "finished_epoch": %s\n}\n' "$(date +%s)" > "$T/dest/.last-status.json"; bash "$TR/check.sh" > "$T/c6.out" 2>&1; rc=$?; check "a FAIL status is a FAIL" [ $rc = 1 ]
printf '{\n  "result": "OK",\n  "finished_epoch": %s\n}\n' "$(date +%s)" > "$T/dest/.last-status.json"; : > "$T/alerts.txt"
echo tampered >> "$T/old-script.sh"; bash "$TR/check.sh" > "$T/c7.out" 2>&1; rc=$?; check "any change to the existing job's script is detected and alerts" bash -c "[ $rc = 1 ] && grep -q 'UNCHANGED' '$T/c7.out' && [ -s '$T/alerts.txt' ]"; echo old > "$T/old-script.sh"
printf '# only a new comment\n0 2 * * * /root/backup-postgres.sh\n' > "$T/crontab.txt"; : > "$T/alerts.txt"; bash "$TR/check.sh" > "$T/c7b.out" 2>&1; rc=$?; check "a comment-only crontab edit is NOT a change" [ $rc = 0 ]
printf '# comment\n0 3 * * * /root/backup-postgres.sh\n' > "$T/crontab.txt"; bash "$TR/check.sh" > "$T/c7c.out" 2>&1; rc=$?; check "changing the existing job's schedule in the root crontab is detected and alerts" bash -c "[ $rc = 1 ] && grep -q 'root crontab' '$T/c7c.out' && [ -s '$T/alerts.txt' ]"; printf '# comment\n0 2 * * * /root/backup-postgres.sh\n' > "$T/crontab.txt"
printf '=== %s trial run start; x\nRESTORE-TEST: 2 pass, 1 fail\n=== %s trial run end rc=1\n' "$(date '+%F %T')" "$(date '+%F %T')" > "$T/run.log"; bash "$TR/check.sh" > "$T/c8.out" 2>&1; rc=$?; check "no passing restore test today is a FAIL" [ $rc = 1 ]
printf '=== 2020-01-01 00:00:00 trial run start; x\nRESTORE-TEST: 6 pass, 0 fail\n' > "$T/run.log"; bash "$TR/check.sh" > "$T/c8b.out" 2>&1; rc=$?; check "a passing restore test from an earlier day does not count" [ $rc = 1 ]
printf '=== %s trial run start; x\nRESTORE-TEST: 6 pass, 0 fail\n=== %s trial run end rc=0\n=== %s trial run start; y\n(second run today died before its restore test)\n' "$(date '+%F %T')" "$(date '+%F %T')" "$(date '+%F %T')" > "$T/run.log"; bash "$TR/check.sh" > "$T/c8c.out" 2>&1; rc=$?; check "if the LATEST run today has no passing restore test, an earlier run's pass does not count" [ $rc = 1 ]
printf '=== %s trial run start; x\nRESTORE-TEST: 6 pass, 0 fail\n' "$(date '+%F %T')" > "$T/run.log"
rm -f "$T/old/"*; bash "$TR/check.sh" > "$T/c9.out" 2>&1; rc=$?; check "a missing dump from the EXISTING job is a FAIL too" bash -c "[ $rc = 1 ] && grep -q 'existing 02:00 job' '$T/c9.out'"
echo "BACKUP TRIAL TESTS: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
