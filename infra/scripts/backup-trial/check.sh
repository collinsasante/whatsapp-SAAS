#!/usr/bin/env bash
# Daily monitor for the parallel trial (cron 08:15). READ-ONLY apart from its ledger. Alerts on any FAIL.
#   /etc/cron.d/verzchat-backup-v2:  15 8 * * * root /opt/verz-backup-v2/check.sh
set -uo pipefail
umask 077
BASE=${TRIAL_BASE:-/opt/verz-backup-v2}; DEST=${BACKUP_DEST:-/opt/backups/whatsapp-platform-v2}; STATE=${TRIAL_STATE:-/var/lib/verz-backup-v2}
LOG=${TRIAL_LOG:-/var/log/verzchat-backup-v2.log}; OLD_DIR=${OLD_BACKUP_DIR:-/root/backups/postgres}; NOTIFY=${TRIAL_NOTIFY:-$BASE/notify.sh}
OLD_SCRIPT=${OLD_SCRIPT:-/root/backup-postgres.sh}; OLD_CRON_D=${OLD_CRON_D:-/etc/cron.d/verzchat-backup}; FRESH_H=${FRESH_HOURS:-26}
mkdir -p "$STATE"; LEDGER=$STATE/ledger.tsv; REPORT=$STATE/last-check.txt; : > "$REPORT"
FAILS=0; pass() { echo "PASS  $1" | tee -a "$REPORT"; }; fail() { echo "FAIL  $1" | tee -a "$REPORT"; FAILS=$((FAILS + 1)); }
chk() { local l=$1; shift; if "$@" >/dev/null 2>&1; then pass "$l"; else fail "$l"; fi; }
latest() { ls -t -- "$DEST"/$1 2>/dev/null | head -1; }
PG=$(latest 'postgres_*.sql.gz'); RD=$(latest 'redis_*.rdb'); PREV=$(ls -t -- "$DEST"/postgres_*.sql.gz 2>/dev/null | sed -n 2p)
chk "new job: last run succeeded within ${FRESH_H} h (status file)" "$BASE/backup.sh" --dest "$DEST" --check-freshness "$FRESH_H"
[ -n "$PG" ] && chk "new job: newest PostgreSQL backup is a valid gzip" gzip -t -- "$PG" || fail "new job: no PostgreSQL backup found"
[ -n "$PG" ] && chk "new job: sha256 sidecar matches" bash -c "cd '$DEST' && sha256sum -c --quiet '$(basename "$PG").sha256'"
[ -n "$PG" ] && chk "new job: PostgreSQL backup and sidecar are mode 600" bash -c "[ \"\$(stat -c %a '$PG')\" = 600 ] && [ \"\$(stat -c %a '$PG.sha256')\" = 600 ]"
[ -n "$RD" ] && chk "new job: Redis snapshot sha256 matches and mode is 600" bash -c "cd '$DEST' && sha256sum -c --quiet '$(basename "$RD").sha256' && [ \"\$(stat -c %a '$RD')\" = 600 ]" || fail "new job: no Redis snapshot found"
chk "new job: backup directory is mode 700" bash -c "[ \"\$(stat -c %a '$DEST')\" = 700 ]"
if [ -n "$PG" ] && [ -n "$PREV" ]; then a=$(stat -c %s "$PG"); b=$(stat -c %s "$PREV"); chk "new job: size within 50%-200% of the previous backup ($a vs $b bytes)" bash -c "[ $a -ge $((b / 2)) ] && [ $a -le $((b * 2)) ]"; fi
today=$(date +%F); chk "new job: today's restore test passed ('RESTORE-TEST: N pass, 0 fail' in the log)" bash -c "awk -v d='[$today' 'index(\$0,d)==1 && /RESTORE-TEST: [0-9]+ pass, 0 fail/{f=1} END{exit f?0:1}' '$LOG'"
chk "new job: free disk >= ${MIN_FREE_MB:-10240} MB" bash -c "[ \$(df -Pm '$DEST' | awk 'NR==2{print \$4}') -ge ${MIN_FREE_MB:-10240} ]"
# the existing job: observed, never touched
OLD=$(ls -t -- "$OLD_DIR"/waplatform_*.sql.gz 2>/dev/null | grep -v _ap3 | head -1)
[ -n "$OLD" ] && chk "existing 02:00 job: newest dump is a valid gzip and under $FRESH_H h old" bash -c "gzip -t '$OLD' && [ \$(( \$(date +%s) - \$(stat -c %Y '$OLD') )) -le $((FRESH_H * 3600)) ]" || fail "existing 02:00 job: no dump found"
if [ -n "$OLD" ] && [ -n "$PG" ]; then a=$(stat -c %s "$OLD"); b=$(stat -c %s "$PG"); chk "cross-check: new and old dumps are within 25% of each other in size ($b vs $a bytes)" bash -c "[ $b -ge $((a * 3 / 4)) ] && [ $b -le $((a * 5 / 4)) ]"; fi
BASELINE=$STATE/old-job-baseline.sha256; CRON_BASE=$STATE/old-job-crontab.sha256
crontab_hash() { crontab -l 2>/dev/null | grep -v '^#' | sha256sum | cut -d' ' -f1; }
if [ -f "$BASELINE" ] && [ -f "$CRON_BASE" ]; then
  chk "existing 02:00 job is UNCHANGED: script and /etc/cron.d file" bash -c "sha256sum -c --quiet '$BASELINE'"
  chk "existing 02:00 job is UNCHANGED: root crontab (comments ignored)" bash -c "[ \"$(crontab_hash)\" = \"$(cat "$CRON_BASE")\" ]"
else sha256sum "$OLD_SCRIPT" "$OLD_CRON_D" > "$BASELINE" 2>/dev/null; crontab_hash > "$CRON_BASE"; echo "baseline of the existing job recorded"; fi
printf '%s\t%s\tfails=%s\tnew=%s %s\told=%s %s\n' "$(date '+%F %T')" "$(hostname -s)" "$FAILS" "${PG##*/}" "$([ -n "$PG" ] && stat -c %s "$PG")" "${OLD##*/}" "$([ -n "$OLD" ] && stat -c %s "$OLD")" >> "$LEDGER"
if [ $FAILS -ne 0 ]; then "$NOTIFY" "VerzChat backup trial monitor: $FAILS check(s) FAILED on $(date +%F). Details: $REPORT" || true; fi
echo "CHECK: $FAILS failure(s)"; exit $((FAILS != 0))
