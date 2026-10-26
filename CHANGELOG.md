# Changelog

All notable changes to Verz (VerzChat) are documented here. The canonical,
live "current version" is served by the app itself at `GET /api/v1/public/version`
(backed by the `app_versions` table) — this file is the human-readable history.
See [VERSIONING.md](./VERSIONING.md) for how releases are created.

## [Unreleased]

### Fixed
- Analytics, and any page that jumps to a section: clicking a section tab or focusing a hidden control could slide the whole app up so the sidebar logo and top bar disappeared. The page now scrolls only its own content and the app frame can no longer be scrolled out of place.
- Inbox: a text message that was delivered but kept showing the sending clock now corrects itself by reloading the conversation after about 40 seconds. Messages to Messenger and Instagram now give up on Meta after 20 seconds instead of waiting indefinitely, so a stalled send shows as failed rather than sending forever.
- Messenger and Instagram: a reply sent from outside VerzChat (the Page inbox, Meta Business Suite, or the Messenger or Instagram app on another phone) now appears in the conversation. These replies reach us as "echoes" and were being thrown away, so the thread looked unanswered and the history had gaps. They are stored once, in the customer's latest conversation, without reopening a resolved one, alerting the team, or changing who owns it.
- Messenger and Instagram: if a customer message or reply could not be stored (for example the database was briefly down), the webhook used to answer "OK" anyway, so Meta never resent it and the message was lost. It now answers with an error so Meta resends, and storing is safe to repeat. A malformed event is skipped instead of being retried forever, and one account failing no longer stops another account in the same delivery.
- Verz AI replies: the reply is now stored with the channel's message id (so delivered and read ticks work on it), and a reply the channel refuses is shown as failed instead of delivered. The fallback message sent when the AI cannot answer is also recorded in the conversation; before, the customer received it and the team never saw it.
- Messenger Pages connected from now on are subscribed to echoes, delivery receipts and read receipts. A Page connected earlier must be reconnected once (Channels, disconnect and connect) and the Meta app must have `message_echoes` switched on; see the upgrade notes.

### Upgrade notes
- **Meta app setup for replies sent outside VerzChat:** in the Meta app dashboard, Webhooks, Page, subscribe to `message_echoes` (and `message_deliveries` and `message_reads` if they are not already on). Then reconnect each Messenger Page in Channels once, because a Page keeps the field list it was subscribed with. Set `FACEBOOK_APP_ID` on the backend: it is how VerzChat tells its own sends from replies typed elsewhere.

### Added
- Reply deadline is now a setting. In Manage, Reply Deadline, an admin chooses how many minutes (1 to 1,440) a customer may wait for a person, or turns the deadline off. It applies to new requests and to requests already waiting; requests already marked overdue stay overdue. The deadline used to be fixed at 15 minutes, which is still the default. This adds one column (`tenant_settings.reply_deadline_minutes`, default 15) and needs the database migration.
- Dashboard: a Requesting card (customers waiting for a person, how many are past the deadline, who has waited longest, and the deadline in force), a WhatsApp account status card read from Meta for each connected number (quality rating, messaging limit, verification, display name, number status, with the time of the check and a Check again button), and a Business and account card (business details, what is missing, plan and billing status, team members, channels, AI credits).

### Changed
- Dashboard: removed the Team, Verz AI, Customers and sales, Recent activity and What to do next sections. Their endpoints under `/dashboard/command` are gone too (`team`, `ai`, `activity`, `recommendations`); nothing else used them.
- The Needs attention list no longer repeats the waiting-requests count (the Requesting card shows it) and counts a request as past the deadline as soon as the deadline passes, instead of waiting up to a minute for the background check.

### Security
- Suspending a workspace or a user now ends their access straight away. Before, only new sign-ins and incoming webhooks
  were blocked, so people who were already signed in kept working (access tokens last up to 30 days, and a session could be
  refreshed without the workspace being checked).
- The platform admin tenant page no longer sends the tenant's WhatsApp access token and webhook verify token to the browser.
  The payment and webhook lists no longer include the provider's raw payload (which can hold card details or message text);
  a webhook's payload is shown only to super admins, on the single event.
- Admin password-reset and invite links are no longer written to the server logs (they contain the live token).
- Admin sign-ins and failed sign-ins are recorded in the audit log, and sign-in, forgot-password and reset-password are
  rate limited. Password reset now validates its input (it accepted any password, including an empty one) and needs 12 to 72 characters.
- The tenant CSV export no longer lets a tenant name run as a spreadsheet formula.
- Suspending a tenant or user, assigning a plan without payment, and granting credits now need a written reason, which is
  stored in the audit log. A single credit grant is limited to 1,000,000.

### Changed
- Platform admin console rebuilt: new navigation, sign-in screen and overview (what needs attention, key numbers, growth, MRR
  movement, recent admin activity), a filterable tenant directory with a tabbed tenant page (members, subscription, AI credits,
  channels, activity), a user directory with an account page, payments, credit wallets and an audit log you can filter. Buttons
  your admin role cannot use are switched off and say why.
- The tenant directory filters, sorts and pages in the database instead of loading every tenant on each request.
- Platform admin billing no longer requests the server in a loop (it hit the rate limit); the error log service filter
  now works across pages.
- The Dashboard is rebuilt as an owner command center. It shows a greeting and workspace, a Today / 7 days / 30 days / custom range kept in the address with comparison to the previous period, key numbers with plain explanations and links, a conversation trend (conversations, messages, new vs returning customers, channels), a "Needs attention" list whose links open the matching filtered inbox, team workload, Verz AI activity and credits, customers and sales, recent activity and evidence-based recommendations. Each section loads on its own and can be retried. Sales and lead figures only appear for workspaces that record them. It uses the same definitions as Analytics, so the numbers agree.
- Inbox links can open pre-filtered: `?status=REQUESTED|UNREPLIED|ACTIVE|RESOLVED`, `?assignee=unassigned|<user id>` and `?channel=`. Unknown values are ignored.
- Analytics page rebuilt around three questions: what is happening, why, and what to do next. Admins get a single filtered view (date range, previous-period comparison, channel) with KPIs, trends, an insights list with evidence and next steps, customer and lead pipeline, conversation backlog and reply speed, a busiest-times heatmap, team workload, Verz AI performance, common conversation labels and order revenue. Agents see only their own conversations.
- Analytics no longer counts the dashboard's own test chats as customer conversations.
- Revenue now comes from Commerce orders (per currency, never mixed). The old page showed VerzChat's own subscription billing under "Revenue"; that is no longer shown there.
- Rebuilt the marketing landing page with a new visual identity: an owner-first story (who answers a customer at 9 pm), an illustrative inbox, honest channel status, and a pricing table generated from the real plan limits. Removed the old landing components, the unverified partner claim in the social preview image, and the fake social proof.

### Added
- Platform admin endpoints: `GET /platform-admin/attention`, `/growth` and `/users/:id`, and filters on tenants, users, audit log, payments and credit wallets. No database changes.
- `GET /analytics/intelligence` (admin only): the aggregated data behind the new page. No database changes.
- Messenger and Instagram now do what WhatsApp does in the inbox:
  - Media you send (images, video, audio, documents on Messenger) is uploaded to Meta directly, so it no longer fails
    when Meta cannot fetch the file from our server. Voice notes are converted so they play.
  - Replying to a message quotes it.
  - Delivered and read ticks update (Messenger: delivered and read; Instagram: read).
  - Chatbot flows, automations and Verz AI now run on inbound messages, with plain-text replies.
  - Options Meta does not support (location, contact cards, and documents on Instagram) are hidden in those chats.

### Fixed
- A message that failed to send no longer counts as the first reply to a customer, so median first-reply times in Analytics and the Dashboard are no longer too fast for workspaces with failed sends.
- Dashboard `days` parameters on the legacy endpoints used by the mobile app are now bounded (1 to 90).
- The contact details panel shows "Messenger user" / "Instagram user" instead of "Unknown".
- Dashboard: the Requesting card shows how many waiting customers are inside and past the reply deadline as a bar, and the longest wait as a gauge against the deadline, instead of listing customer names. The WhatsApp and Business cards now line up at equal height.
- Commerce and Tasks pages rebuilt. Products, Orders, Revenue and Tasks now share one layout: a compact summary, filters and search, a table that pages, and a side panel for details and actions. Revenue shows gross sales, refunds, platform fee and what you keep for any period, compared with the period before it, with a day-by-day chart, sales by product and a transaction list. Orders gain status tabs, a date range and a detail view with fulfilment actions. Tasks gain views (To do, Mine, In progress, Done), an "Up next" suggestion and urgency ordering. See docs/commerce-and-tasks.md for what the figures mean and what is not supported yet.
- Dashboard layout reworked: four headline numbers in one row, four alert tiles (past the reply deadline, waiting for a reply, no owner, failed to send) with a link to the matching inbox view, the conversation trend with opened, resolved and customer-message totals beside the WhatsApp account status, and the business profile, subscription and requests in a right-hand column. Failed campaigns and channel problems still appear under the alerts. The WhatsApp card now separates what Meta reports from what VerzChat recorded for QR-connected phones, and says plainly when a verification has expired or a display name was declined.
- Dashboard restyled to a new design: the greeting uses the workspace name, with the last-updated time and refresh at the top right; the four numbers have large round icons and a change arrow against the previous period; the alert tiles are tinted by kind with an icon, count and link, and a View all link; the conversation trend has its own period picker and a View table button with Opened, Resolved and Customer messages totals beneath; the WhatsApp status card sits beside it with a Connected status, a quality and verification grid, and the QR phones with Check again; and Business and subscription is one tall card on the right with plan, usage and Edit business details and Manage plan buttons. The Requesting card is no longer on the dashboard; requests past the reply deadline still show as the first alert tile, and the deadline is still set in Manage.

## [2.5.0] - 2026-10-23

### Added
- Facebook and Instagram account picker: filter by name, Select all and Deselect all (they act on what the filter
  shows), and a count of how many are selected.
- Messenger and Instagram contacts now get their real name from Meta when they write in, instead of showing as
  "Unknown". Contacts we have no name for show as "Messenger user" or "Instagram user".

### Fixed
- The Contacts page no longer crashes when a Messenger or Instagram contact (which has no phone number) is in the list.
- The channel marker on avatars (WhatsApp Web QR, Messenger, Instagram) is larger and easier to read.

### Changed
- Sending a message now writes a short server log line (channel, type, timing, whether the provider returned an id,
  never the text) and the browser console shows the same lifecycle, to track down "sent but still shows as sending".
- Connecting Facebook or Instagram now writes a short line to the server log with how many accounts Meta returned and
  how many Pages the person granted the app (counts only: no tokens, names or ids). It answers "why do I see fewer
  accounts than I have" without guessing.

### Upgrade notes
- **Facebook Pages managed through a Business portfolio** are only returned by Meta when the Facebook Login for
  Business configuration includes `business_management` (now added to the production configuration). For customers
  outside your own team this permission needs Meta App Review.
- No new settings and no migration.

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
