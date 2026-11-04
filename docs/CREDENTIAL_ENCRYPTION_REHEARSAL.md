# Credential encryption: rehearsal (2026-11-04)

Run on a disposable local PostgreSQL 17 database with a disposable key generated in memory and discarded. **No production key was generated, requested, printed or transmitted, no production data was touched, and nothing was enabled.** Production encryption stays off until the user has securely installed the production key and the approval gates in `docs/CREDENTIAL_ENCRYPTION_PLAN.md` have passed.

The tool the earlier plan calls `encrypt-existing-credentials.ts` is `apps/backend/src/common/crypto/credential-reencryption.cli.ts` (engine `credential-reencryption.ts`, locations `credential-reencryption.targets.ts`). The rehearsal driver is `credential-encryption-rehearsal.ts`; operators run it through `infra/scripts/credential-encryption-rehearsal.sh`, which refuses a database that is not marked disposable.

## Result: 34 of 34 checks passed
Run: `REHEARSAL_DATABASE_URL=postgresql://user@127.0.0.1:5432/rehearsal_creds infra/scripts/credential-encryption-rehearsal.sh`. The seed holds 14 credentials across all eight locations (the `channels.credentials` JSON holds Telegram bot token and webhook secret, TikTok posting and TikTok messaging access/refresh tokens, and an Instagram token).

| Area | What was checked |
|---|---|
| Coverage | all 8 locations are covered; each holds seeded credentials |
| Dry run | exits 0, says nothing was written, database byte-identical (state hash) |
| Backup | a `pg_dump -Fc` is taken before any write and restores |
| Safety flag | `--apply` without `--i-have-a-verified-backup` is refused and writes nothing |
| Apply | exits 0, verification pass ok, zero plaintext left, ciphertext in every location, every original recoverable with the key |
| Dump check | before: the plain dump contains every seeded secret (so the check can detect them); after: **none** appear in a fresh dump |
| Output hygiene | stdout/stderr of every run contains no credential, no key, no tenant id |
| Idempotency | a second apply changes 0 rows and does not double-encrypt |
| Wrong key | aborts with a non-zero exit **before any write**; database byte-identical; same for the rollback command |
| Missing, malformed and short key | refused; nothing written |
| Wrong key on a half-finished state | the dangerous case: aborts, state untouched (without the abort the remaining plaintext would be encrypted under a second key) |
| Key loss | with a different key all 16 ciphertexts are unreadable; none silently decrypts |
| Restore | the pre-encryption backup restores to a byte-identical credential state |
| Rollback | `--decrypt --apply` verifies and returns the **exact original bytes** |
| Already-encrypted and mixed data | applies cleanly, nothing left plaintext, originals recoverable once (no double encryption) |
| Interrupted run | a crash after 3 writes leaves a mix; nothing is corrupt (all still recoverable); re-running finishes and verifies |
| Compare-and-set conflict | the application writes a newer value mid-run: the tool does not overwrite it, counts the conflict, verification asks for a re-run, and a re-run encrypts the newer value |

Mutation checks: removing the pre-write wrong-key abort fails three checks, including "interrupted + wrong key" and the resume (the data really does split across two keys); the unit and database suites already fail when the compare-and-set condition is removed.

Also fixed by this review: the Telegram **webhook secret** (stored in `channels.credentials` since the Telegram work) was not in the tool's field list, so it would never have been encrypted by the backfill or restored by the rollback. It is now covered (field list guarded by a unit test).

## Recovery procedures, as rehearsed
* **Before the window:** verified dump (taken and restore-checked as above), kept off the host.
* **Roll back after encrypting:** `--decrypt --apply --i-have-a-verified-backup` with the same key restores the exact original values; then unset the key and recreate the services.
* **If the run is interrupted:** nothing is lost; run the same command again.
* **If the key is lost or wrong:** the tool refuses to write; ciphertext is unreadable without the key, so the recovery is the pre-encryption dump (loses writes since) or re-entering each credential (reconnect WhatsApp numbers, OAuth channels, Telegram bot, regenerate webhook secrets, re-pair WhatsApp Web by QR). This is why two-person offline custody of the key is a prerequisite.

## What this does NOT show (still to do, in this order)
1. **A staging run on a restored copy of production-shaped data**, after the AP-3 gate: same script, with the key set on every service first (the production worker has no key variable until this release). Volume and duration at production size are unmeasured.
2. **Service behaviour with the key set:** a WhatsApp send, a webhook, a Messenger reply, a campaign send, a WhatsApp Web restart. The rehearsal exercises the tool and the database, not the running services.
3. **Key custody and installation by the user.** Not done and not done by this work.
4. **Production enable** only after 1 to 3 pass and the user approves the window.
