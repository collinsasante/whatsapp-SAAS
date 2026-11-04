#!/usr/bin/env bash
# One-week PARALLEL TRIAL of the repaired backup (approved 2026-11-04). Runs next to, never instead of, the existing 02:00 job.
# Cron (installed as /etc/cron.d/verzchat-backup-v2):  30 2 * * * root /opt/verz-backup-v2/run.sh
# Writes only to BACKUP_DEST (a new directory) and to its own log/state; it reads the production databases and nothing else; it transmits nothing except a
# data-free alert text to the ntfy topic the existing health check already uses.
set -uo pipefail
umask 077
BASE=${TRIAL_BASE:-/opt/verz-backup-v2}; DEST=${BACKUP_DEST:-/opt/backups/whatsapp-platform-v2}; LOG=${TRIAL_LOG:-/var/log/verzchat-backup-v2.log}
STATE=${TRIAL_STATE:-/var/lib/verz-backup-v2}; ENVF=${BACKUP_ENV_FILE:-/root/whatsapp-platform/infra/.env}; NOTIFY=${TRIAL_NOTIFY:-$BASE/notify.sh}
mkdir -p "$STATE" "$(dirname "$LOG")"; touch "$LOG"; chmod 600 "$LOG"
{
  echo "=== $(date '+%F %T') trial run start; backup.sh sha256 $(sha256sum "$BASE/backup.sh" | cut -c1-16); restore-test sha256 $(sha256sum "$BASE/backup-restore-test.sh" | cut -c1-16)"
  RETAIN_DAYS=${RETAIN_DAYS:-14} MIN_KEEP=${MIN_KEEP:-7} "${BACKUP_CMD:-$BASE/backup.sh}" --dest "$DEST" --env-file "$ENVF" --verify-restore --prune
} >> "$LOG" 2>&1
rc=$?
echo "$(date +%s) $(date '+%F %T') rc=$rc" >> "$STATE/runs.log"
echo "=== $(date '+%F %T') trial run end rc=$rc" >> "$LOG"
if [ $rc -ne 0 ]; then "$NOTIFY" "VerzChat backup v2 trial FAILED (exit $rc). Existing 02:00 backup is unaffected. See $LOG" || true; fi
exit $rc
