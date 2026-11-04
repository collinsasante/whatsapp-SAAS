# Production credential encryption: scope, risks and staged plan (design only; nothing applied)

Basis: repository review on `integration/staging-candidate-v2` plus the read-only findings of 2026-11-04 (production `CREDENTIALS_ENCRYPTION_KEY` empty on backend and whatsapp-web, absent from the worker's compose environment; 8 of 8 stored WhatsApp tokens plaintext). No key was generated, no value read or printed, nothing on the server touched in this pass.

## 1. What the key protects (when set) and what it never does
Cipher: AES-256-GCM, random 12-byte IV, `enc:v1:` prefix, 32-byte base64 key (`packages/shared-utils/src/credentials-encryption.ts`). **Writes encrypt only if a key is configured; with no key the value is stored as plaintext.** **Reads are dual-mode:** a value without the prefix is returned as is; a prefixed value with no key throws.

| Credential | Table.column | Encrypted when the key is set? |
|---|---|---|
| WhatsApp Cloud API token | `whatsapp_numbers.access_token` | yes (write path and reads in backend, worker) |
| Facebook Page token | `facebook_page_connections.page_access_token` | yes |
| Facebook/Instagram user token during connect | `oauth_connect_sessions.user_access_token` | yes |
| Instagram, Facebook, TikTok (new) tokens | `channels.credentials` (JSON: `accessToken`, `refreshToken`) | yes (individual fields) |
| Webhook signing secrets | `webhooks.secret` | yes on write; older rows need the backfill (`webhook-secret-backfill`) |
| WhatsApp Web (Baileys) auth state | `whatsapp_web_sessions.encrypted_auth_state` | yes (whatsapp-web service) |
| **Telegram bot token** | `channels.credentials.botToken` | **never**: stored plaintext by `connectTelegramBot` (and also used as the external id fallback) |
| **Airtable API key** | `tenant_settings.airtable_api_key` | **never** (plain column) |
| Legacy tenant WhatsApp token | `tenants.access_token` | **never** (legacy column) |
| Platform-admin 2FA secret, email-verify and reset tokens, invitation tokens, push tokens, call link tokens | various | **never** (single-use or low-value, but readable from a dump) |
| Passwords, login PIN, refresh tokens, API keys, admin session tokens | `password_hash`, `login_pin`, `refresh_token`, `key_hash`, `token_hash` | hashed (not reversible), appropriate |

So enabling the key alone does not make the database free of usable secrets: Telegram bot tokens, the Airtable key and the legacy tenant token stay readable. Those need code changes (encrypt on write) in addition to the key.

## 2. Exposure today (key empty)
* **Database dumps and backups:** the nightly 02:00 dump, the parallel-trial dump, any `pg_dump` copied for debugging and the Redis RDB all contain the plaintext tokens above. With the key set they would contain ciphertext, which protects the dump **only if the key is not stored beside it**.
* **Where the key would live:** `infra/.env` on the same host (currently mode 644, parent directory 700). Encryption therefore protects off-host copies, stolen dumps and read-only SQL access, **not** a compromise of the host or of root. State this to avoid false assurance.
* **Logs:** the old backup log leaked an SMTP password fragment (separate request B). The new code does not log tokens.
* **Administrative access:** any role that can run SQL on production sees plaintext tokens; platform-admin and support tooling that query these tables are in scope.
* **Replicas:** none exist today (single Postgres container); the future off-host backup copy is the main new place data would go.

## 3. Can it be enabled without invalidating existing tokens? Yes, if the order is right
Because reads accept plaintext, setting the key does not break existing rows. The hazard is **write-before-read**: once one service writes an `enc:v1:` value, every service that reads it must hold the key, or it throws. In production the **worker's compose environment has no `CREDENTIALS_ENCRYPTION_KEY` at all**, so the worker (campaign sends, quality sync) would fail the moment a token is encrypted. The compose file must give the worker the key before any value is encrypted.

## 4. Staged plan (each stage verified before the next; each reversible)
0. **Prerequisites (no production change):** write and test `scripts/encrypt-existing-credentials.ts` (it is referenced in code comments but **does not exist**; the webhook backfill is the pattern): dry run by default, counts and tenant ids only, never prints a value, refuses to run without a valid key, idempotent (skips `enc:v1:`), compare-and-set per row, a `--decrypt` mode for rollback; cover all tables in section 1 including JSON fields. Add encrypt-on-write for the Telegram bot token and the Airtable key with dual-read, and test on staging. Decide key custody (below).
1. **Backup:** verified dump (`ap3-dump.sh both` style, restore-checked) immediately before.
2. **Key generation and custody:** `openssl rand -base64 32` on a trusted machine, never on the VPS shell history; stored in a password manager and as a sealed offline copy held by two named people; recorded fingerprint (SHA-256 of the key, first 8 hex) in the runbook so a wrong key is detectable.
3. **Distribute the key to every reader/writer at once:** backend, worker, whatsapp-web, realtime if it reads credentials. One compose change, recreate those production containers together in a window (about 1-2 minutes of interruption each, estimated). Reads of existing plaintext keep working. Verify: a WhatsApp send, a webhook, a Messenger reply, a campaign send, a Baileys reconnect.
4. **Re-encrypt:** dry run, review counts, apply, with the app running (compare-and-set protects concurrent edits). Verify counts of `enc:v1:` equal totals; send/receive tests again; restart-survival test of WhatsApp Web sessions on staging first.
5. **Dump check:** take a dump and confirm no plaintext token patterns remain in the covered columns.
6. **Rollback:** (a) before stage 4: unset the key, recreate (nothing is encrypted yet); (b) after stage 4: run the script's `--decrypt` with the key, then unset it; (c) last resort: restore the pre-stage-1 dump (loses writes since then).
7. **Key-loss recovery:** if the key is lost, encrypted values are unrecoverable. Recovery is operational: reconnect each WhatsApp number (re-enter token), Facebook/Instagram/TikTok via OAuth, Telegram bot token, regenerate webhook secrets (customers must update their endpoints), and **re-pair every WhatsApp Web session by QR**. This is why the two-person offline custody is a prerequisite, not an extra.
8. **Rotation (later):** introduce `enc:v2:` with key ids so a new key can be added while the old one still decrypts; not needed for the first rollout.

## 5. Staging rehearsal (after the gate)
Staging already runs with the key set; rehearse stage 4's script and the `--decrypt` rollback there on a copy of production-shaped data, and test the Telegram and Airtable encrypt-on-write changes, before proposing the production window.

## 6. Approval wording (unchanged in substance)
"Approve enabling credential encryption in production in a window I will name." Prerequisite work (stage 0) and the staging rehearsal need no production access and can proceed first.


## 7. Implementation status (2026-11-04 evening)
Done and tested locally (nothing enabled, no key generated, no server touched):
* `apps/backend/src/common/crypto/credential-reencryption.ts` (engine), `credential-reencryption.targets.ts` (eight locations), `credential-reencryption.cli.ts`, script `pnpm --filter @whatsapp-platform/backend credentials:reencrypt`. Production image command: `docker exec <backend> node dist/common/crypto/credential-reencryption.cli.js [--decrypt] [--apply --i-have-a-verified-backup]`.
* Targets: `whatsapp_numbers.access_token`, `facebook_page_connections.page_access_token`, `oauth_connect_sessions.user_access_token`, `tenants.access_token`, `tenant_settings.airtable_api_key`, `webhooks.secret`, `whatsapp_web_sessions.encrypted_auth_state`, and the `accessToken`, `refreshToken`, `botToken` fields of `channels.credentials`.
* Properties proven by 27 tests (21 in-memory, 6 on a real PostgreSQL through the real Prisma adapters; a mutation that removes the compare-and-set condition makes one fail): dry run writes nothing; refuses without a valid key; KEY CHECK aborts before any write if any stored ciphertext does not open with the supplied key, even when the data is partly encrypted; idempotent; compare-and-set so a value the application rewrites mid-run is kept (and verification then asks for a re-run); rollback (`--decrypt`) restores the exact original bytes; pagination; reports contain counts only (no value, id or tenant id) and an 8-hex key fingerprint.
* Application paths changed so the key can be turned on safely (`5d05af4`): the legacy tenant token, Telegram bot token and Airtable key are encrypted on write and decrypted on read (dual-read: plaintext rows keep working), the worker resolver decrypts the legacy tenant token, and `GET /tenant` no longer returns credentials.
* Compose: the production worker now receives `CREDENTIALS_ENCRYPTION_KEY` (empty by default, so no behaviour change until a key is set).

Order for the production window (unchanged in principle, now concrete): (1) verified dump; (2) key from the password manager into the production env file; (3) recreate backend, worker and whatsapp-web together (the worker only after this release is deployed); (4) smoke tests (WhatsApp send, Messenger reply, campaign send, WhatsApp Web reconnect); (5) dry run, review counts and the key fingerprint; (6) `--apply --i-have-a-verified-backup`, re-run until `changedConcurrently` is 0 and verification is ok; (7) new dump check; (8) record the fingerprint. Rollback: `--decrypt --apply` with the same key, then unset the key and recreate.
Not yet done: the staging rehearsal (needs the staging deploy), key generation and custody (done by you; I will not generate or see the key), and the production window itself.
