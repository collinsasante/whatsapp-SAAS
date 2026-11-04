# Approval requests (separate, nothing below has been applied)

Each request is independent. Reply with the sentence under "To approve" to authorise only that item.

## A. Meta Page webhook subscription (staging test Page)
* **Now:** subscribed to `messages`, `messaging_postbacks` (verified read-only against Meta).
* **Change:** subscribe to `message_echoes`, `message_deliveries`, `message_reads` as well, using the existing connect path (`POST /{page-id}/subscribed_apps` with all five fields).
* **Effect:** replies sent from the Page inbox or another device appear in VerzChat; delivered and read ticks start updating. No new permission or app review.
* **Risk / rollback:** low; resubscribe with the two original fields. Staging Page only.
* **To approve:** "Approve subscribing the staging Page to message_echoes, message_deliveries and message_reads."

## B. Credential and permission remediation (production)
Findings: old backup log (mode 644) holds an SMTP password fragment on 154 lines; `infra/.env` and `/root/env-backups/*` are mode 644; the apps send `REDIS_PASSWORD` but Redis has no `requirepass`.
* **Steps, each reversible, in order:** 1) archive then truncate the old log; 2) `chmod 600` on `.env` and env backups (verify `docker compose config -q`); 3) rotate the SMTP password at the provider and update `.env`; recreate only backend and worker in a window; 4) enable `--requirepass` on Redis and recreate Redis with backend, worker, realtime in one window.
* **Impact:** steps 1-2 none; steps 3-4 restart production containers (about 1-2 minutes of interruption each, estimated).
* **To approve (can be split):** "Approve steps 1 and 2 now." / "Approve steps 3 and 4 in a window I will name."

## C. TikTok developer-console settings
* **Needed for sign-in:** staging redirect URI `https://staging.verzchat.com:8443/api/v1/channels/oauth/tiktok/callback` (appears registered already); the production redirect URI before production use; scope `user.info.basic` (default).
* **Needed only for posting (not implemented in VerzChat):** `video.publish` (direct post) or `video.upload` (drafts), TikTok app review, and an audit before posts can be public; media pulled by URL needs a verified domain or URL prefix.
* **I will not change any console setting.** A person with console access makes these changes.
* **To approve work on posting:** "Build TikTok publishing once video.publish is approved for the app."

## D. Off-host disaster recovery
Decisions needed before any data leaves the VPS:
1. **Destination:** recommendation Backblaze B2 (EU region) for independence from the VPS provider and Object Lock; alternative Hetzner (EU, flat price, no confirmed Object Lock). All third-party prices unverified.
2. **Key custody:** an offline primary key held by you, an escrow key held by a named second person; no private key on the VPS.
3. **Install `age` and `restic`** from the Ubuntu repositories on the VPS.
4. **Data scope:** database and Redis dumps now; MinIO media (about 7.5 GB) and an encrypted secrets archive next.
5. **Data processing:** customer data would be stored by the destination provider (a data-processing agreement and region choice).
* **Definition of done:** a real encrypted upload, a restore on a second machine using only the offline key, a passing restore test, an alert when the job is stopped on purpose.
* **To approve:** "Use <provider>, region <region>, key holders <names>; install age and restic; start with database and Redis."

## E. Production release of the reviewed work (later)
After staging verification: the TikTok fix, Messenger history import, AI tool-authorization fix and AI lease, with the two additive migrations. Requires its own approval and a window; not requested yet.

## F. Credential encryption is OFF in production (new finding, read-only check)
* **Now:** `CREDENTIALS_ENCRYPTION_KEY` is empty on the production backend and whatsapp-web containers, and the production worker is not given it at all. All 8 stored WhatsApp access tokens in production are plaintext in the database (`enc:v1:` prefix count 0). Staging has the key set. Production is consistent (every service reads and writes plaintext), so nothing is broken today; the exposure is that a database dump or backup contains usable tokens (the new TikTok tokens and Facebook Page tokens would be stored the same way).
* **Change (when approved):** generate a 32-byte key and keep it in a password manager and the offline custody set (losing it makes every stored token unreadable); set it on backend, worker and whatsapp-web; run the existing `scripts/encrypt-existing-credentials.ts` after taking a verified database dump; verify; recreate those production containers in a window.
* **Risk / rollback:** a wrong or missing key on any one service breaks reads; rollback is restoring the dump plus unsetting the key. Needs a window and a backup first.
* **To approve:** "Approve enabling credential encryption in production in a window I will name."
