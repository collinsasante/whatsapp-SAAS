# Changelog

All notable changes to Verz (VerzChat) are documented here. The canonical,
live "current version" is served by the app itself at `GET /api/v1/public/version`
(backed by the `app_versions` table) — this file is the human-readable history.
See [VERSIONING.md](./VERSIONING.md) for how releases are created.

## [Unreleased]

### Changed
- Connecting Facebook or Instagram now writes a short line to the server log with how many accounts Meta returned and
  how many Pages the person granted the app (counts only: no tokens, names or ids). It answers "why do I see fewer
  accounts than I have" without guessing.

## [2.4.0] - 2026-10-23

### Fixed
- Automations: the inactivity trigger can be saved (its database value was missing).
- Facebook: workspaces that manage more than a few Pages (Meta returns them in batches) now see all of them when
  connecting. Only the first batch was read before.
- Instagram: connecting now shows a picker, like Facebook, and connects only the account chosen. It used to connect
  every Instagram account behind every Page it could see.

### Added
- Disconnect on every channel card that is connected through a login: Instagram (per account, plus Remove), TikTok
  and Telegram. An account with no conversations is removed; one with history is disconnected and kept so past
  conversations keep their channel.
- Instagram messaging: messages sent to a connected Instagram account arrive in the inbox, and agents can reply with
  text, images, video and audio. Shared posts, reels and story mentions show as a labelled link. Replies from the
  Instagram app itself are not copied into Verz. Needs the Meta app to be Live and Instagram messaging webhooks
  pointed at the existing Messenger webhook URL (see deployment notes).

### Security
- The Channels API no longer returns stored credentials (Telegram bot tokens, TikTok and Instagram access tokens) to
  any workspace member. Anyone who could open Channels could previously read them from the response.
- Instagram Page tokens are stored encrypted whenever `CREDENTIALS_ENCRYPTION_KEY` is configured.
- Adding a website to the knowledge base can no longer be pointed at internal addresses. Every address, every redirect
  and the connection itself are checked; internal, loopback, link-local and reserved IPv4/IPv6 ranges are refused, and
  only ports 80 and 443 are allowed. The shared address check also now covers more IPv6 forms.
- Knowledge-base changes, uploads, website import, "learn from conversations" and "remove duplicates" are now
  admin-only (members and viewers can still read the list). Agents who used these will now see a permission error.
- "Learn from conversations" now obeys `KB_LEARNING_DISABLED` (it stays off unless set to `false`) and can run at most
  once per workspace per 30 minutes, so it cannot be used to trigger repeated paid AI requests.
- The AI's order-status check only returns orders that belong to the customer in the current conversation.
- Platform-admin requests are now checked against the database on every request. A switched-off or demoted admin loses
  access immediately instead of when their login token expires, and an admin token that was not issued by this
  environment's own database is rejected even if it is correctly signed.

### Upgrade notes (read before deploying)
- **No new required settings. No migration in this release's own changes** (the inactivity enum migration shipped
  earlier with the fix above).
- **"Learn from conversations" stays off** until `KB_LEARNING_DISABLED=false` is set (its button used to bypass the
  switch). Knowledge-base editing, upload and website import are now admin-only.
- **Instagram messaging needs Meta setup** before it can receive anything: the app must be Live, and an Instagram
  webhook subscription (field `messages`) must point at the existing Messenger callback URL with the same verify
  token. The Instagram account must allow access to messages. It has not yet been tested against real Meta.
- **Rotate Telegram bot tokens and TikTok connections.** Until this release the Channels API returned stored tokens to
  every workspace member.

## [2.3.0] - 2026-10-20

Combines the security and mobile work first prepared as 2.3.0 on 2026-09-23 (written here but never recorded as a
release) with the fixes and features validated on staging since. It builds on 2.2.1, which shipped separately as a
production hotfix.

### Upgrade notes (read before deploying)
Required on the backend (the server refuses to start, or rejects the affected traffic, without them):
- `JWT_SECRET` and `JWT_REFRESH_SECRET`: real values. The server will not start with the placeholder defaults.
- `FACEBOOK_APP_SECRET`: Messenger webhooks are rejected in production without a valid signature.
- `WHATSAPP_WEB_INTERNAL_API_KEY`: internal service calls are rejected without it.

Recommended, not required: `WHATSAPP_APP_SECRET` (Meta app secret for the WhatsApp app) and `RESEND_WEBHOOK_SECRET`.
Until they are set the server logs one warning per start and accepts those webhooks unsigned, exactly as before this
release. As soon as they are set, signatures are enforced and a wrong signature is rejected. Set and test them after the
release, not as a condition of it. `WHATSAPP_APP_SECRET` is newly passed through `docker-compose.yml`, so a recreated
backend container receives it from `infra/.env`.

Optional: `CREDENTIALS_ENCRYPTION_KEY` (encrypts stored channel credentials and webhook secrets; back it up before
setting it) and `FACEBOOK_LOGIN_CONFIG_ID` / `INSTAGRAM_LOGIN_CONFIG_ID` for Meta apps that use Facebook Login for Business.

No database migrations. The WhatsApp Web (QR) service is not part of `deploy.sh` and must be updated separately.

### Added
- Webhooks: a signing secret is generated automatically when a webhook is created, shown once, and can be rotated.
  Customer webhook URLs are checked so they cannot target internal addresses.
- Media Library: "All Media" and "Sent by Agents" tabs with agent, channel, type, date and direction filters.
- Account page shows the Workspace ID with a copy button.
- Voice notes sent to WhatsApp Web (QR) contacts are converted to a format WhatsApp can play, with a clearer player.
- WhatsApp Web (QR) conversations have their own icon and a channel filter. View-once and undecryptable messages show a
  clear placeholder, and nothing from them is stored.
- Calling: a clear message explains what to enable when calling is not set up for a number.
- Facebook Login for Business support through an optional configuration ID.
- Mobile: Tasks screen, AI Activity and Learning tabs, push notifications, Commerce, Team management and avatar upload.
- Native mobile refresh-token sign-in, app-wide light and dark themes, and a Contact Us page.
- Analytics overview extended with customer, resolution, calls and CSAT metrics (web and mobile).

### Changed
- Billing: Stripe is removed from the plan upgrade screen. AI credit purchases use the workspace email, and decorative
  emojis are removed from billing screens.
- Statuses no longer appear in Global.
- Requests rejected by the rate limiter now return 429 and are logged, instead of looking like a 503 outage.
- Anonymous WhatsApp contacts are stored by their WhatsApp address, never as a made-up phone number, and opaque IDs are
  no longer shown as names.
- Production now refuses to start if critical authentication secrets are missing or left at their default values.

### Fixed
- Returning a conversation to Verz AI makes the AI reply again, while human-owned chats stay protected.
- Messages from WhatsApp Web (QR) contacts show their real text instead of "[Sent a message type we can't display yet]".
- Owner is saved as Owner when creating a team member, and role grants are checked on the server.
- Unread counts appear for customer replies on resolved conversations.
- Dashboard crash when optional data was missing, and failed requests no longer take down the page.
- Library cleanup no longer deletes files that conversations still use, which caused broken images in old chats.
- Legacy AI credit charges are recorded atomically, and the prompt-injection check catches more phrasings.
- Customers who use a WhatsApp username (Business-Scoped User ID) are accepted, so their messages are not dropped.
- Replies to customers who use a WhatsApp username are addressed with Meta's `recipient` field instead of `to`, for text,
  media, templates, locations, contacts, reactions and interactive messages.
- Saving WhatsApp API credentials no longer fails when Meta refuses to set up webhook delivery. The number is saved, and the
  screen shows Meta's reason as a warning instead of a generic error.
- Fixed a privilege-escalation vulnerability that let a workspace member grant themselves or others a higher role than their own, including OWNER
- Messenger inbound webhooks now require a valid signature in production, and WhatsApp and inbound email webhooks are verified as soon as their secrets are configured (a warning is logged until then), so forged inbound messages can be blocked
- Fixed channel connection credentials (WhatsApp/Facebook access tokens) not being encrypted at rest in production
- Fixed an unauthenticated file-upload/serve gap that could allow a stored cross-site-scripting attack via the media library
- Removed an unrestricted image-proxy configuration that could be used to process attacker-supplied remote images
- Fixed dead API/socket hostnames in the mobile app after a backend domain change

## [2.2.1] - 2026-10-12

Shipped directly to production as a hotfix branch off 2.2.0, independent of
2.3.0 below (which was on `staging` at the time and not yet in production).
Both are now merged together here — 2.2.1 is currently the actual `isLatest`
version recorded in `app_versions`, despite 2.3.0 having a higher number;
2.3.0 was written here but never recorded via the release API. Whichever
version staging eventually releases next should account for both.

### Fixed
- Replying to a message on desktop no longer jumps the scroll position away from where you were reading.
- The message input no longer loses focus after sending — you can keep typing the next message without clicking back into the box.
- Voice notes: fixed a silent failure on some recording errors, fixed a file-type labeling issue that could make your own sent voice notes fail to play back in some browsers, and added a visible "uploading" state while a voice note is sending.
- Sending multiple files or Verz Media (File Library) items no longer blocks the chat while they upload — you can keep working, and failed sends now show clearly with a retry option instead of silently disappearing.

## [2.2.0] - 2026-09-20

### Added
- WhatsApp via QR (unofficial linked-device) connection is now fully working end-to-end
- Facebook Messenger channel integration

### Fixed
- Fixed WhatsApp-web session events failing silently with 404s due to a missing API route prefix
- Fixed WhatsApp Web QR pairing failing on every attempt due to a stale WhatsApp protocol version
- Fixed a Docker volume-naming bug that could silently orphan data on service rebuild
- Fixed a production-wide outage caused by services splitting across two Docker networks after a rebuild
- Excluded internal testing/evaluation data from real Orders and Revenue views
- Added a missing authorization check on an internal AI testing endpoint

### Changed
- Developer/testing tools (Testing Center, Test Chat, Evaluation Runs) are no longer visible in production
- WhatsApp-web sessions now recover cleanly from an expired QR code instead of retrying silently
- Added protection against two service instances ever running the same WhatsApp-web session concurrently

## [2.1.0] - 2026-07-18

Recorded retroactively — this release predates the changelog/versioning process set up in this repo, reconstructed from the release record already in the database.

### Added
- Platform admin: users grouped by workspace with click-to-expand, all tables now clickable

### Fixed
- Fixed a schema drift bug causing intermittent 500 errors across conversations and settings
- Fixed a crash when replying to a deleted or not yet synced message
- Fixed a crash on every inbound WhatsApp emoji reaction
- Fixed a crash when a WhatsApp webhook payload was missing the phone number
- Fixed a race condition that could crash message processing when a contact messaged twice in quick succession
- Fixed inbound images and documents not displaying or downloading correctly
- Fixed workspace filter, search, and sort controls in platform admin not refetching data
- Fixed offline-queued messages being silently lost when local device storage was unavailable

### Changed
- Inbound media and message processing failures now alert immediately instead of failing silently
- Reworked attachment downloads: files open in a new tab on click, download available via right-click
- Deploy pipeline now refuses to run from the wrong git branch, preventing a repeat of a real incident where production silently ran untested code for hours

## [2.0.0] - 2026-05-21

### Added
- Email verification on signup
- 2-step authentication via email OTP
- Knowledge base file upload (PDF, TXT, CSV, MD)
- URL scraping for knowledge base
- Mobile-responsive campaigns, dashboard, and inbox
- Real-time dashboard KPI cards via WebSocket
- Always-visible message read receipts

### Fixed
- Welcome message now fires correctly for contacts with prior outbound messages
- Dashboard KPI cards update in real-time
