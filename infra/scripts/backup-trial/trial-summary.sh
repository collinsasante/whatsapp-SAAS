#!/usr/bin/env bash
# End-of-trial summary from the monitor's ledger. READ-ONLY: it decides nothing and retires nothing; the owner decides whether to retire the 02:00 job.
#   /opt/verz-backup-v2/trial-summary.sh
# Verdict "READY FOR A DECISION" needs: at least 7 distinct days checked, every one of the last 7 checks with 0 failures, and a passing restore test recorded each day.
set -uo pipefail
STATE=${TRIAL_STATE:-/var/lib/verz-backup-v2}; LEDGER=$STATE/ledger.tsv; DAYS=${TRIAL_DAYS:-7}
[ -s "$LEDGER" ] || { echo "No ledger yet at $LEDGER: the monitor has not run."; exit 1; }
total=$(cut -f1 "$LEDGER" | cut -d' ' -f1 | sort -u | wc -l | tr -d ' ')
echo "Days with a check: $total (need $DAYS)"
echo "Last $DAYS checks:"; tail -n "$DAYS" "$LEDGER" | awk -F'\t' '{printf "  %s  %s  %s  restore=%s\n", $1, $3, $5, $NF}'
bad=$(tail -n "$DAYS" "$LEDGER" | grep -vc 'fails=0'); norestore=$(tail -n "$DAYS" "$LEDGER" | grep -vc 'restore=[0-9]* pass, 0 fail')
if [ "$total" -ge "$DAYS" ] && [ "$bad" -eq 0 ] && [ "$norestore" -eq 0 ]; then echo "VERDICT: READY FOR A DECISION (nothing has been retired or changed; the owner decides)."; exit 0; fi
echo "VERDICT: NOT READY (days=$total, checks with failures=$bad, checks without a passing restore test=$norestore)."; exit 1
