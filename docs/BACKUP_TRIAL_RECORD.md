# Parallel backup trial: record and decision sheet

The approved one-week parallel trial runs the repaired backup (`/opt/verz-backup-v2/run.sh`, 02:30 CET) beside the existing 02:00 job, which is **not touched, not replaced and not retired by this document or by any script here**. The monitor (`check.sh`, 08:15 CET) is read-only apart from its own ledger.

Trial facts: installed 2026-11-04 (a manual run that day does not count as a scheduled run); first scheduled run **2026-11-05 02:30 CET**; first monitored scheduled day 2026-11-05 08:15.

## What the daily monitor now verifies (each is an alert if it fails)
| Area | Check |
|---|---|
| Completion | the last run succeeded within 26 h (status file); from day two the 02:30 run itself happened today |
| Integrity | newest dump is a valid gzip and matches its sha256 sidecar; same for the Redis snapshot; size within 50% to 200% of the previous dump |
| Counts | the table count and migration-row count the backup validated against the live database are present, and **neither falls** between checks (growth after a deploy is fine); warnings the backup recorded are shown |
| Restore | the day's latest run has `RESTORE-TEST: N pass, 0 fail` (exact per-table row counts, migrations and indexes in a throwaway database) |
| Permissions | backup directory 700; dumps, snapshots and sidecars 600 |
| Retention | at most `RETAIN_DAYS + 3` PostgreSQL backups kept (pruning works); every backup has its sidecar and no sidecar is orphaned; no stale partial files |
| Existing job | its newest dump is valid and under 26 h old; within 25% of the new dump in size; its script, `/etc/cron.d` file and root crontab are byte-for-byte unchanged since the baseline |
| Disk | free space at least 10 GB |
| Off-host | **only once a destination is approved** (the approval file exists): the last encrypted upload succeeded within 26 h. Until then it prints an INFO line; there is no off-host copy and the monitor says so |
| Alerting | any FAIL sends a data-free alert through the existing ntfy topic. Optional `DEADMAN_PING_URL` (an external dead-man's-switch service) is pinged, data-free, only on a fully passing day, so a dead cron (which cannot report its own death) shows up as silence. It is not configured; choosing the service is the owner's decision |

The ledger (`/var/lib/verz-backup-v2/ledger.tsv`) keeps one line per check; `trial-record.md` beside it keeps the readable table below. Tests: `infra/scripts/tests/backup-trial.test.sh` (44 checks, run on Linux), `backup.test.sh` (44).

## Installing the updated monitor (after the AP-3 gate; a server change, so it needs your go-ahead)
Copy `backup-trial/check.sh` and `backup-trial/trial-summary.sh` over their counterparts in `/opt/verz-backup-v2/`. The cron file does not change. The ledger gains three columns; older lines are tolerated.

## Daily record (copy from `/var/lib/verz-backup-v2/trial-record.md` each morning)
| Date | Scheduled run (02:30) | Monitor result | Backup bytes | Tables | Migrations | Restore test | Existing job unchanged | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-11-05 | not yet run | not yet run | | | | | | |
| 2026-11-06 | | | | | | | | |
| 2026-11-07 | | | | | | | | |
| 2026-11-08 | | | | | | | | |
| 2026-11-09 | | | | | | | | |
| 2026-11-10 | | | | | | | | |
| 2026-11-11 | | | | | | | | |

No row above is filled in: nothing has been read from the server since the trial was installed, and none will be invented.

## End of trial
`/opt/verz-backup-v2/trial-summary.sh` prints the last seven checks and a verdict. **READY FOR A DECISION** needs at least seven distinct days, no failure in the last seven checks, and a passing restore test on each. It changes and retires nothing. Retiring the 02:00 job (commenting it out, never deleting the script) is a separate decision for the owner after reading this sheet. Roll back at any point by removing `/etc/cron.d/verzchat-backup-v2`.

## Off-host (not part of this trial)
Tooling is complete and tested locally (`docs/BACKUP_AND_DR.md` section 6). Nothing is transmitted until the owner records the destination, region, two key holders, encryption and access model in the approval file. A local-directory test is not evidence of a real off-host backup, and the monitor will not report one until a real upload has succeeded.
