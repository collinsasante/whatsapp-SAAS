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
# The restore-test summary line carries no timestamp, so it is attributed to a run by position: the latest "=== <today> ... trial run start" marker must be followed by RESTORE-TEST: N pass, 0 fail.
# From the second day, the SCHEDULED run must actually have happened: a run recorded since 02:25 today (a manual run on the install day does not count towards this).
START_FILE=$STATE/trial-start-date; [ -f "$START_FILE" ] || date +%F > "$START_FILE"
if [ "$(date +%F)" != "$(cat "$START_FILE")" ]; then
  chk "new job: the 02:30 scheduled run happened today (run recorded since 02:25)" bash -c "last=\$(tail -1 '$STATE/runs.log' 2>/dev/null | cut -d' ' -f1); [ -n \"\$last\" ] && [ \"\$last\" -ge \$(date -d \"\$(date +%F) 02:25\" +%s) ]"
fi
today=$(date +%F); chk "new job: the latest run today had a passing restore test ('RESTORE-TEST: N pass, 0 fail' after its start marker)" bash -c "awk -v d='=== $today' 'index(\$0,d)==1 && /trial run start/{f=0; seen=1} seen && /RESTORE-TEST: [0-9]+ pass, 0 fail/{f=1} END{exit (seen && f)?0:1}' '$LOG'"
chk "new job: free disk >= ${MIN_FREE_MB:-10240} MB" bash -c "[ \$(df -Pm '$DEST' | awk 'NR==2{print \$4}') -ge ${MIN_FREE_MB:-10240} ]"
# ---- what the new job itself recorded: counts, warnings (backup.sh validated these against the live database when it ran) ----------------------
STAT=$DEST/.last-status.json
jget() { sed -n "s/.*\"$1\": *\"\{0,1\}\([^\",}]*\).*/\1/p" "$STAT" 2>/dev/null | head -1; }
TABLES=$(jget postgres_tables); MIGS=$(jget postgres_migration_rows); WARN=$(jget warnings)
chk "new job: its own status records a table count and a migration count (tables=${TABLES:-none}, migrations=${MIGS:-none})" bash -c "[ \"${TABLES:-0}\" -ge 1 ] && [ \"${MIGS:-0}\" -ge 1 ]"
PREV_LINE=$(tail -1 "$LEDGER" 2>/dev/null); PTABLES=$(echo "$PREV_LINE" | sed -n 's/.*\ttables=\([0-9]*\).*/\1/p'); PMIGS=$(echo "$PREV_LINE" | sed -n 's/.*\tmigs=\([0-9]*\).*/\1/p')
if [ -n "$PTABLES" ] && [ -n "${TABLES:-}" ]; then chk "counts: tables did not fall since the last check ($PTABLES -> $TABLES)" [ "$TABLES" -ge "$PTABLES" ]; fi
if [ -n "$PMIGS" ] && [ -n "${MIGS:-}" ]; then chk "counts: migration rows did not fall since the last check ($PMIGS -> $MIGS)" [ "$MIGS" -ge "$PMIGS" ]; fi
if [ -n "$WARN" ]; then echo "WARN  new job recorded warnings: $(echo "$WARN" | cut -c1-200)" | tee -a "$REPORT"; fi
# ---- retention (the trial runs with --prune): bounded, no orphans, no stale partial files ----------------------------------------------------
N=$(ls -- "$DEST"/postgres_*.sql.gz 2>/dev/null | wc -l | tr -d ' '); LIMIT=$(( ${RETAIN_DAYS:-14} + 3 ))
chk "retention: $N PostgreSQL backups kept (limit $LIMIT; pruning works)" [ "$N" -le "$LIMIT" ]
chk "retention: every backup has its sha256 sidecar and no sidecar is orphaned" bash -c "cd '$DEST' && for f in postgres_*.sql.gz redis_*.rdb; do [ -e \"\$f\" ] || continue; [ -e \"\$f.sha256\" ] || exit 1; done; for s in *.sha256; do [ -e \"\$s\" ] || continue; [ -e \"\${s%.sha256}\" ] || exit 1; done"
chk "retention: no stale partial or temporary files older than a day" bash -c "[ -z \"\$(find '$DEST' -maxdepth 1 \( -name '*.partial' -o -name '.status.*' \) -mmin +1440 2>/dev/null)\" ]"
# ---- off-host copy: checked ONLY once a human has approved a destination (until then there is nothing to check, and that is expected) ------------
if [ -e "${OFFHOST_APPROVAL:-/etc/verz-offhost/approval.conf}" ]; then
  chk "off-host: the last encrypted upload succeeded within ${OFFHOST_FRESH_HOURS:-26} h" "${OFFHOST_SCRIPT:-$BASE/offhost-backup.sh}" --check-freshness "${OFFHOST_FRESH_HOURS:-26}"
else echo "INFO  off-host: no approved destination yet, so no off-host copy exists (expected; see docs/BACKUP_AND_DR.md section 6)" | tee -a "$REPORT"; fi
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
RT=$(awk -v d="=== $(date +%F)" 'index($0,d)==1 && /trial run start/{r=""} /RESTORE-TEST: [0-9]+ pass, [0-9]+ fail/{r=$0} END{sub(/.*RESTORE-TEST: /,"",r); print r}' "$LOG" 2>/dev/null)
printf '%s\t%s\tfails=%s\tnew=%s %s\told=%s %s\ttables=%s\tmigs=%s\trestore=%s\n' "$(date '+%F %T')" "$(hostname -s)" "$FAILS" "${PG##*/}" "$([ -n "$PG" ] && stat -c %s "$PG")" "${OLD##*/}" "$([ -n "$OLD" ] && stat -c %s "$OLD")" "${TABLES:-}" "${MIGS:-}" "${RT:-none}" >> "$LEDGER"
# one human-readable record per daily check, kept beside the ledger (this is the "document each trial run" record)
RECORD=$STATE/trial-record.md
[ -s "$RECORD" ] || printf '| Checked | Result | Backup | Bytes | Tables | Migrations | Restore test | Existing 02:00 job |\n|---|---|---|---|---|---|---|---|\n' > "$RECORD"
printf '| %s | %s | %s | %s | %s | %s | %s | %s |\n' "$(date '+%F %H:%M')" "$([ $FAILS -eq 0 ] && echo PASS || echo "FAIL ($FAILS)")" "${PG##*/}" "$([ -n "$PG" ] && stat -c %s "$PG")" "${TABLES:-?}" "${MIGS:-?}" "${RT:-none}" "$([ -n "$OLD" ] && echo "${OLD##*/}" || echo missing)" >> "$RECORD"
if [ $FAILS -ne 0 ]; then "$NOTIFY" "VerzChat backup trial monitor: $FAILS check(s) FAILED on $(date +%F). Details: $REPORT" || true
elif [ -n "${DEADMAN_PING_URL:-}" ]; then
  # Dead-man's switch: a data-free GET to an external service that alerts if the pings STOP (a dead cron cannot report its own death). Only on a fully passing day.
  curl -fsS -m 10 -o /dev/null "$DEADMAN_PING_URL" || echo "WARN  dead-man ping could not be delivered" | tee -a "$REPORT"
fi
echo "CHECK: $FAILS failure(s)"; exit $((FAILS != 0))
