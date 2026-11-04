# Backups and disaster recovery

Status as of 2026-11-04. Production and staging share one VPS (Contabo). This document records what was found, what was repaired and verified, what is **not yet in place**, and the design that needs the owner's decisions before any data leaves the server.

## 1. What was found (2026-11-04, before any change)

| Item | Finding |
|---|---|
| Working nightly backup | `/root/backup-postgres.sh` from root's crontab, 02:00 server time (CET). `docker exec wa_postgres pg_dump ... \| gzip > file` with `set -e` but **no `pipefail`**: a failed `pg_dump` still leaves a "successful" gzip and a "Backup created" log line. No integrity check, no completion check, files are mode 644 in `/root/backups/postgres`, 7-day `find -mtime +7 -delete` retention, **local only**. Script sha256 `aa0335a2ecdb2952...`. |
| Repository job | `infra/scripts/backup.sh` (sha256 `b84a00cfebd810a4...`, identical on the VPS and on `origin/staging`) runs at 02:00 from `/etc/cron.d/verzchat-backup`. **It has been failing since 2026-06-03**, every night. |
| Root cause of that failure | The script `source`s `infra/.env`. That file is a docker-compose env file, where values may contain spaces. Line 49 (`SMTP_PASS`) has an unquoted space, so bash runs the second word as a command (`command not found`) and `set -e` aborts before any dump. Lines 60 and 61 (TikTok client id and secret) have the same flaw. The error message also writes a **fragment of the value into the log** (`/var/log/verzchat-backup.log`). |
| Upload | The old script would upload plaintext dumps to Backblaze B2 if an rclone remote named `b2` existed. There is none (no `rclone.conf`), so nothing was ever uploaded. **There is no off-host copy of anything.** |
| What is not backed up at all | MinIO media/uploads (`wa_minio`, about 7.5 GB, the only copy), `.env` and other secrets/credentials, Let's Encrypt state (partly in `/root/certbot-backups`), Redis AOF (a Redis RDB was only ever taken by the broken job), the VPS itself (no provider snapshot is known). |
| Redis | `.env` sets `REDIS_PASSWORD` but the server has no `requirepass` (unauthenticated `PING` answers `PONG`). It publishes no host port, so it is reachable only from Docker networks. |
| File permissions | `infra/.env` is mode 644 (the parent `/root` is 700, so it is not world-reachable). Existing dumps are 644. |
| Verified restorable? | Never tested before today. |

**Credential hygiene follow-ups (not done; they change production configuration or secrets):** `SMTP_PASS` should be rotated, because a fragment of it was written to `/var/log/verzchat-backup.log` by every failed run since 2026-06-03 (the log should then be cleaned, keeping a root-only archive). Lines 49, 60 and 61 of `infra/.env` contain unquoted spaces: harmless to docker-compose, which reads them literally, but they break anything that `source`s the file; quote them only after confirming how compose parses the quoted form. Set `infra/.env` to mode 600. Either enforce the Redis password on the server or remove `REDIS_PASSWORD` from the env file so the two agree.

Effective protection before this work: one local copy per night on the same disk as production (RPO up to 24 h for the database, unbounded for media, nothing if the server or its disk is lost).

## 2. The repaired workflow (implemented, verified, **not yet scheduled**)

Files: `infra/scripts/backup.sh` (rewritten), `infra/scripts/backup-restore-test.sh` (new), `infra/scripts/tests/backup.test.sh` (44 hermetic checks), `infra/scripts/tests/backup-encryption-roundtrip.sh` (new).

`backup.sh` guarantees:
* `set -Eeuo pipefail`, `umask 077`, `PIPESTATUS` checked for the `pg_dump | gzip` pipeline; one run at a time (`flock`); free-space and database-readiness preflight.
* **Never sources `.env`.** It reads only `POSTGRES_USER`, `POSTGRES_DB` and `REDIS_PASSWORD` with a strict parser that executes nothing; the Redis password goes through the environment, never a command line.
* The dump is written to a partial file and moved into place only after validation: gzip integrity, the `PostgreSQL database dump complete` marker, table count equal to the live database, `_prisma_migrations` row count equal to the live database, size not under half of the previous dump (warning under 80%). It is then `chmod 600`, with a `.sha256` sidecar. An existing file is **never overwritten**.
* Redis: `BGSAVE` with `LASTSAVE` change detection, copy, checksum equality with the source, and `redis-check-rdb`. A password in `.env` is used only if the server requires one; the mismatch is recorded as a warning.
* Logs contain file names, sizes, hashes and counts only; no secrets and no row data (asserted by the tests).
* `.last-status.json` (result, timestamps, hashes, counts, warnings) is written atomically; `--check-freshness HOURS` turns it into a monitoring check.
* Retention is **opt-in** (`--prune`): only files it created (they have a `.sha256` sidecar), never the newest `MIN_KEEP`, never unrelated files.
* `--verify-restore` runs `backup-restore-test.sh` on the new dump.

`backup-restore-test.sh` restores into a **throwaway** PostgreSQL (same image, `--network none` so no Docker network or iptables change, PGDATA on tmpfs, memory cap, label, removed on exit) and compares **exact per-table row counts parsed from the dump itself** with the restored database, plus table count, migrations (a rolled-back migration with `rolled_back_at` is legitimate history; a failed one has neither `finished_at` nor `rolled_back_at`) and indexes. It never reads or writes production.

### Verification performed (real, on the production VPS, into a new directory; the existing job was not touched)

| Check | Result |
|---|---|
| Hermetic failure-path tests (stub `docker`), including `pg_dump` exiting 1 after a complete dump (only the exit code reveals it), truncated or empty dump, table or migration mismatch, existing-file collision, concurrent run, hostile `.env` and database name, Redis password never on a command line, stuck `BGSAVE`, corrupted Redis copy, retention rules, permissions | 44 pass, 0 fail. A mutation test (exit-code check removed) makes exactly the new test fail. |
| `backup.sh --verify-restore` against production and the real `.env` (line 49 included) | PostgreSQL 77 MB, 105 tables, 100 migration rows validated; Redis 1.8 MB validated; throwaway restore in 27 s; **993,742 rows equal to the dump in all 105 tables**; 175 foreign keys, 359 indexes. No leftover container; 18 production containers throughout. |
| The existing nightly dump (old script, 02:00) restored with the same test | 105 tables, 990,894 rows, exact. The old backups are restorable. |
| Secrets in logs | None of the 41 `.env` values appear in any log or status file. The only matches are the database user and name, which the log prints deliberately (identifiers, not secrets). |
| Permissions | Directory 700; dumps, snapshots, sidecars and status 600. |
| Real-environment defects found and fixed by this run (the stub tests had not caught them) | `redis-check-rdb` prints its verdict four lines before the end (the check looked at the last three); the stub now prints the real shape. The restore test's first migration check ignored `rolled_back_at` and failed on two legitimate rolled-back rows. Both fixes are tested. The failed runs are kept in the evidence directory. |

Evidence: `/root/backup-repair-validation-20261104T105100Z/` on the VPS (root-only): `run1`/`run2` failed runs (kept), `run3.log`, `restore-of-old-nightly.log`, `encryption-roundtrip.log`, the validation backups with sidecars and `.last-status.json`.

### Cutover (needs approval; do after the AP-3 formal re-check, which depends on the existing 02:00 job)
1. Record hashes of `/root/backup-postgres.sh`, `/root/whatsapp-platform/infra/scripts/backup.sh`, `/etc/cron.d/verzchat-backup`, `crontab -l` (already recorded in section 1).
2. Install `backup.sh` and `backup-restore-test.sh` to a new path (for example `/usr/local/sbin/verz-backup`), not over the old files.
3. Add a second job at 02:30 CET (after the existing 02:00 job, before `certbot` at 03:00) writing to `/opt/backups/whatsapp-platform-v2` with `--verify-restore` weekly. Run both for a week; compare. Add a `--check-freshness 26` monitor.
4. After a week with no failure, retire the two old jobs (comment out, do not delete the scripts) and enable `--prune` with explicit retention.
5. Rollback at any point: remove the new cron entry; the old jobs are untouched.

## 3. Recovery objectives (proposed, to be confirmed by the owner)

| | Today | After cutover | Target after off-host DR |
|---|---|---|---|
| Database RPO | up to 24 h, same disk | 24 h, same disk | 24 h off-host; 1 h or less only with WAL archiving (later) |
| Media RPO | no backup | no backup | 24 h off-host (incremental) |
| Restore time (measured) | untested | database restore 25-45 s on this host; end-to-end rebuild untested | target RTO 4 h for a rebuilt server, to be proven by a drill |
| Loss of the VPS or its disk | **total loss** | total loss | recoverable from the off-host copy |

## 4. Off-host disaster recovery: design (nothing is implemented against an external destination)

Principles: encrypt **before** anything leaves the host; the server holds only a public key, so a compromised server cannot read old backups; the credentials the server holds can add objects but not delete or overwrite them; restores are tested from the off-host copy on a different machine using only the offline key.

### Options (prices are third-party figures from 2026 and are **unverified**; confirm on each vendor's page before deciding)
| Option | Notes |
|---|---|
| Backblaze B2 | about $6-7 per TB-month, egress free up to 3x stored, S3 API, Object Lock supported. EU region available. Mature rclone/restic support. Different provider and jurisdiction from Contabo. |
| Hetzner Storage Box / Object Storage | EU, flat-rate, low price (Storage Box over SFTP/rsync, or S3-compatible object storage). Good fit for an EU-only data policy; no confirmed Object Lock. |
| Cloudflare R2 | about $0.01-0.015 per GB-month, no egress fee, S3 API. Same vendor as the CDN in front of the site: acceptable, but it concentrates risk with an account already holding DNS. |
| Wasabi | about $7-8 per TB-month, 90-day minimum retention, 1 TB minimum billing. Less suitable for a few GB. |
| Contabo Object Storage | cheapest add-on, but **the same provider and network as the VPS**: correlated failure; not recommended as the only copy. |

Data volume is small (database dump about 77 MB per night, Redis about 2 MB, media about 7.5 GB), so a 30 daily + 12 monthly set plus the media is on the order of 10-15 GB: roughly a dollar a month on any option. **Choose on security and independence, not price.**

### Recommended architecture
* **Database and Redis:** after `backup.sh` validates a dump, a separate `backup-offhost.sh` (not yet written) encrypts it to the owner's public key (`age` preferred, `gpg` works today), writes a manifest (hashes, sizes, counts), and copies the ciphertext with rclone to the chosen bucket. Local plaintext stays under 700/600.
* **Media (MinIO, 7.5 GB):** incremental, deduplicated and encrypted (restic or rclone crypt) so the nightly cost is only the delta. Needs a quiesced or versioned read of the MinIO data; design to be settled with the MinIO layout.
* **Secrets and config:** `.env`, `daemon.json`, cron files, certificate state: a small encrypted archive on every change, with the same key. Compose files and images are rebuildable from git.
* **Key custody:** two recipients: the owner's primary key held offline (hardware token or password manager plus a printed copy in a safe), and a second escrow key held by a named second person. **No private key ever lives on the VPS.** A drill must prove restoration with only the offline key.
* **Credentials:** a bucket-scoped application key allowing write and list but not delete; retention by bucket lifecycle plus Object Lock (for example 30 days compliance). Retention: 7 daily, 4 weekly, 6 monthly.
* **Monitoring:** `backup.sh --check-freshness 26` plus a dead-man's-switch (an external service that alerts when the nightly success ping stops; the ping carries no data), delivered through the existing ntfy topic. Alert on any non-zero run and on a restore-test failure.
* **Restore drills:** monthly, automated, from the off-host copy into a throwaway database (`backup-restore-test.sh`), plus a yearly full rebuild on a scratch server.

### What was proven locally (no data left the server)
`infra/scripts/tests/backup-encryption-roundtrip.sh` on the real validated dump with a throwaway key: the server-side keyring holds only the public key and cannot decrypt; the ciphertext has no readable SQL; encryption of 80 MB took 0.2 s with no size overhead; the decrypted file is byte-identical; a single flipped byte and a truncated ciphertext are both rejected; the decrypted copy restores with exact row counts (993,742 rows, 105 tables). 8 of 8 pass; all keys and plaintext copies were removed.

### Not done, and why
No upload, no account, no credentials, no paid service: the destination, the data-transfer design (customer data leaving the VPS makes the storage provider a processor, which needs a data-processing agreement and a region decision) and the key holders all need the owner's approval. `age` and `restic` are not installed on the VPS; installing them is a server change that needs approval too.

### Decisions needed
1. Destination provider and region (recommendation: Backblaze B2 in an EU region, or Hetzner if EU-only and no Object Lock is acceptable).
2. Key holders: who holds the primary offline key and the escrow key.
3. Permission to install `age` (and `restic` for media) from the Ubuntu repositories.
4. Retention and budget; whether customer media may be stored off-host and under what agreement.
5. Approval of the cutover plan in section 2.

### Definition of "off-host DR complete"
A real encrypted backup uploaded to the approved destination from the server, a second machine that has only the offline key downloads it, decrypts it and passes `backup-restore-test.sh`, the dead-man's-switch alert fires when the job is stopped on purpose, the restore time is recorded, and the drill is repeated by a second person. **None of this has happened.**

## 5. Restore from nothing: checklist (to be proven by a drill)
1. New server with Docker; restore `.env` and config from the encrypted secrets archive.
2. Check out the matching git revision; `docker compose up` for postgres and redis only.
3. Decrypt and restore the newest validated dump into the empty database; run `backup-restore-test.sh` logic against the result.
4. Restore the Redis RDB and the MinIO data; start the application services; verify health.
5. Re-point DNS only with explicit approval (not part of this document).
