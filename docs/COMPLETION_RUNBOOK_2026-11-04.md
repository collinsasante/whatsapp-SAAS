# Completion programme: channel matrix and approval-dependent procedures (2026-11-04)

All statements below were checked in code on the candidate branch unless marked otherwise.

## 1. Channel capability matrix (what is real)
| Channel (enum) | Connect | Receive | Send | History import | Token refresh | Notes |
|---|---|---|---|---|---|---|
| WHATSAPP (Cloud API) | credentials form | webhook | yes | not applicable (Meta does not serve history) | long-lived system token | primary channel |
| WHATSAPP_WEB (Baileys) | QR pairing | socket | yes | none | session in Postgres | unofficial; re-link risk on logout |
| FACEBOOK_MESSENGER | OAuth + Page picker | webhook (`messages`, `postbacks` subscribed on staging) | yes | **new**: Conversations API import (`c716f45`) | Page tokens long-lived | needs `message_echoes`, `message_deliveries`, `message_reads` subscribed for external replies and ticks |
| INSTAGRAM | OAuth + account picker | webhook (same handler) | yes | not implemented | via Page token | |
| TELEGRAM | bot token verified by `getMe` | **none: no webhook or polling code exists** | **none** | none | n/a | `Connected` is shown but no message can flow. NOT IMPLEMENTED beyond connection |
| TIKTOK | OAuth (`5137f20` fixes the exchange) | none | none | none | **new** worker job | account verification only; TikTok publishes no third-party messaging API; publishing (`video.publish`) not implemented and needs app approval and an audit |
| EMAIL, WEB_CHAT, TWITTER, LINKEDIN | enum values only | none | none | none | | NOT IMPLEMENTED |

Consequence for the UI: Telegram and TikTok cards read as connected; the TikTok card already states that Business Messaging is pending. The Telegram card should say the same (small copy change, not done here).

## 2. Meta webhook subscription for the Messenger Page (needs your approval; nothing was changed)
Verified read-only from Meta (`GET /me/subscribed_apps` with the staging Page token): subscribed fields are `messages`, `messaging_postbacks`.
Missing, and requested by the code (`MESSENGER_PAGE_FIELDS`): **`message_echoes`**, **`message_deliveries`**, **`message_reads`**.
* Effect today: replies sent from the Page inbox, Business Suite or another device are not stored in VerzChat; delivered/read ticks never update.
* Effect of adding them: those three event types start arriving at the existing webhook (the handler for all three already exists: echo, delivery and read receipts). No new permission or app review is needed for these fields on an app that already has `pages_messaging`.
* Safe way to apply (when approved): disconnect and reconnect the Page in Channels (the connect flow calls `POST /{page-id}/subscribed_apps?subscribed_fields=<all five>` and stores them), or call that endpoint once with the Page token. Verify afterwards with `GET /me/subscribed_apps` and send a reply from the Page inbox: it should appear in VerzChat.
* Rollback: `POST /{page-id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks` restores the current state.

## 3. TikTok: what a human does after the candidate is deployed to staging
1. In staging, Channels, TikTok, "Continue with TikTok", log in and authorise.
2. Expected: redirect to `/channels?success=tiktok`, toast "TikTok connected!", a TikTok card showing the account name.
3. Evidence to collect (no secrets): backend log line `TikTok account connected for tenant …`; the channel row has `credentials.accessToken` and `refreshToken` starting `enc:v1:`; worker log `[TikTokTokenRefresh] pass:` within 10 minutes; after about 1.5 h (`expires_in` is 2 h, refresh when under 30 min) a `TikTok token refreshed` line; disconnect gives `TikTok authorization revoked` and empty credentials.
4. If it fails, the toast and the backend log now carry TikTok's own error code, description and `log_id`.
Settings still required in the TikTok developer console (not changed by me): the staging redirect URI `https://staging.verzchat.com:8443/api/v1/channels/oauth/tiktok/callback` registered (it evidently is), the production redirect URI before production use, and for any posting feature the `video.publish` (direct post) or `video.upload` (drafts) scope approved plus the TikTok audit (unaudited clients post privately only; URL-based media needs a verified domain or URL prefix).

## 4. Credential and permission remediation (needs your approval; nothing changed)
Findings (2026-11-04): `/var/log/verzchat-backup.log` (mode 644, 154 lines, first 2026-05-20) contains a fragment of the SMTP password; `infra/.env` is mode 644 (parent `/root` is 700); the app receives `REDIS_PASSWORD` but the Redis server has no `requirepass`; env backups exist in `/root/env-backups` (644).
Plan, in this order, each reversible:
1. **Log:** copy the old log to a root-only archive (600), then truncate the original (`: > file`); keep the archive until the SMTP password is rotated, then delete it.
2. **Permissions:** `chmod 600 infra/.env /root/env-backups/*`; verify `docker compose` still reads the file (it runs as root) with `docker compose config -q`.
3. **SMTP password:** rotate at the mail provider, update `.env`, recreate only the backend/worker containers that read it in a maintenance window; verify a test email. Rollback: previous value is still valid at the provider until revoked.
4. **Redis:** add `--requirepass ${REDIS_PASSWORD}` to the Redis command in compose, recreate Redis together with backend, worker, realtime in one window (the apps already send the password); verify `NOAUTH` for unauthenticated `PING` and a working app. Rollback: remove the flag and recreate. BullMQ queues survive because Redis uses AOF.
These touch production containers, so they need your approval and a window.

## 5. Cloudflare 521/522 impact of the IPv6 stalls
Minimum access: a Cloudflare API token with **Analytics Read** on the zone, or dashboard view access. Method: Analytics, Traffic or Security, filter on HTTP status 521, 522, 523 by 5-minute bucket for 3 days; then test whether errors cluster at a ~9-minute period (compare with stall ends at 543-551 s spacing in `docs/VPS_IPV6_EGRESS_INVESTIGATION.md`). Alternatively, an external IPv6 client polling the production health URL every 15 s for an hour. Note: the staging hostname reaches the origin over IPv4 only; production's origin path should be checked the same way (the production nginx log shows Cloudflare IPv6 addresses connecting, so that leg is in use there).

## 6. Quality gaps stated plainly
* No ESLint configuration exists at app level, so lint cannot run (installing a config is a repo-wide decision).
* The frontend has no test runner; the new UI code is typechecked only.
* The BullMQ + real PostgreSQL AI queue tests, real-provider AI validation and the full product regression on staging have not been run (they need the staging deploy, which waits for the AP-3 check).
