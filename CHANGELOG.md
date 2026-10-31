# Changelog

All notable changes to Verz (VerzChat) are documented here. The canonical,
live "current version" is served by the app itself at `GET /api/v1/public/version`
(backed by the `app_versions` table) — this file is the human-readable history.
See [VERSIONING.md](./VERSIONING.md) for how releases are created.

## [Unreleased]

### Added
- **AI Digital Self.** Every agent now has a Digital Self that learns how they write (tone, reply length, emoji, greetings, language) from the replies they type themselves. It never learns from saved replies, templates, automated messages or text written by Verz AI, and it never changes prices, stock, policies or who owns a conversation. In Team, an admin can see what each one has learned, pause learning, correct a style or reset it. In a conversation, an admin or the owner can choose whose style Verz AI uses, and can exclude the conversation from learning, which also removes what was learned from it. It does nothing until it is switched on for a workspace.

### Changed
- Verz AI now answers several quick messages from a customer once, with the whole burst in view, instead of replying to each one. It still replies to every message when they are not sent in a burst, and it never holds back a request for a person or a reply that changed an order or delivery.
- A follow-up that points back at what was just discussed ("I want that one", "what about the other one?", "can I get it today?") now keeps its subject, so Verz AI has the right information in front of it. A plain "ok thanks" still looks nothing up.
- Verz AI copes better with spelling mistakes in a customer's message ("delivary" finds Delivery).
- The original Verz AI responder (used when Commerce is off) now asks DeepSeek not to use its thinking mode for its short JSON reply, and asks once more if the answer comes back blank. On staging 5 of 6 test replies came back blank before this change; whether it helps is still to be confirmed on staging. Other AI features keep their existing settings.
- Verz AI no longer picks one answer silently when two pieces of business information disagree (for example two delivery fees). It says it cannot confirm which is right and suggests asking a team member.
- Workspaces on the original Verz AI responder now get the same tone guidance as the others: emoji only when they fit, no reflexive closing line, and no repeating an answer.
- When a Digital Self is chosen for a conversation, its style now takes precedence over the general defaults for length, emoji, greeting and energy, so the difference between agents is visible.

### Fixed
- Test Chat now answers in the conversation it shows, so a Digital Self chosen there applies to the reply.
- Verz AI: when a customer sends several messages in quick succession, each reply now sees the conversation in the right order. Before, the message being answered could appear twice and the assistant's own latest reply could be missing, which made replies repeat or miss the point.
- Verz AI no longer pulls unrelated knowledge-base articles for a greeting, thanks or a short follow-up. Questions are matched on their real subject (mobile money and "momo", delivery and shipping, opening hours), and a follow-up like "how much for delivery?" keeps the product being discussed.
- Verz AI no longer treats ordinary requests as attacks: "give me the phone number of the shop", "give me the user guide" and "you are now a bit late with my order" now get a normal reply. Real attempts to extract other customers' data or change the assistant's role are still blocked.
- A reply from the AI that is cut off, malformed, or an internal error is never sent to a customer. It is handled like any other failed AI reply: a team member is asked to pick the conversation up.
- Customers who ask for a person in everyday wording ("I need to talk to someone", "can someone call me", "abeg make I talk to somebody") are handed to the team, including on workspaces using the original Verz AI responder, which did not detect this before.

## [2.8.3] - 2026-10-30

### Fixed
- **Large images failed to send on WhatsApp with "Media upload error".** WhatsApp refuses any image over 5 MB, and a 7.6 MB PNG hit that limit twice. Images over the limit are now converted to JPEG and, only if still too large, scaled down, keeping their proportions. Images under 5 MB that are already JPEG or PNG are sent exactly as before. This, and not the image format fixed in 2.8.2, is the confirmed cause of the reported failure (found from the stored file's size on production).

## [2.8.2] - 2026-10-30

### Fixed
- **Images in WebP or GIF format could fail to send on WhatsApp** with "Media upload error". WhatsApp accepts only JPEG and PNG images, so these are now converted to JPEG before sending (GIFs go out as a still image, and transparent areas become white). JPEG and PNG images are sent unchanged. This is the likely cause of the reported failure, not yet confirmed against the original message.

### Changed
- Media sends now write clearer log lines: the file's real format and size, WhatsApp's own reason when an upload is refused, and the failure code WhatsApp reports for a message. No phone numbers, message text or storage keys are logged.

## [2.8.1] - 2026-10-26

### Changed
- Dashboard: the four Needs attention tiles are white with the standard grey border, the same grid spacing as the key number cards, and near-black counts, labels and links. The icon on each tile keeps its colour as the cue for urgency.

## [2.8.0] - 2026-10-26

### Added
- **Reply deadline setting.** In Manage, Reply Deadline, an admin chooses how many minutes (1 to 1,440) a customer who asked for a person can wait. The dashboard's "requests past the reply deadline" alert and the inbox use it.
- **Dashboard rebuilt for owners.** Four headline numbers (conversations, new customers, median first response, resolution rate), four alert tiles (past the reply deadline, waiting for a reply, no owner, failed to send) that open the matching inbox view, a conversation trend with a period picker and table view, the WhatsApp account status as Meta and VerzChat report it (quality, messaging limit, verification, display name, and QR-connected phones with a Check again action), and a Business and subscription card. Failed campaigns and channel problems appear under the alerts when present.
- **Products, Orders, Revenue and Tasks pages rebuilt** on one layout: a compact summary, search and filters, a table that pages, and a side panel for details and actions. Revenue shows gross sales, refunded, platform fee and what you keep for any period against the period before, with a day-by-day chart, sales by product and a transaction list. Orders gain status tabs, a date range and a detail view with fulfilment actions. Tasks gain views, an "Up next" suggestion and urgency ordering. See docs/commerce-and-tasks.md for what each figure means and what the backend does not support yet.
- Landing page entrance and scroll animations.

### Changed
- **Revenue "You keep" is calculated differently from the old Revenue page.** It is gross sales minus the money refunded minus the platform fee (after the fee returned on refunds). The old page subtracted the small fee reversal instead of the refunded amount, so its net was too high whenever there had been a refund.
- **Verz AI credits are now reserved before an AI call and settled after it** (new `ai_credit_reservations` table), with idempotent settlement and expiry of unsettled reservations.
- Releasing the staging environment now builds versioned images and rehearses the database restore first (infrastructure only; production deployment is unchanged).

### Fixed
- Messenger and Instagram: a reply sent from outside VerzChat (the Page inbox, Meta Business Suite, or the app on another phone) now appears in the conversation. If a message could not be stored the webhook now answers with an error so Meta resends it, instead of losing it.
- Verz AI replies are stored with the channel's message id (so delivered and read ticks work on them), and a reply the channel refuses shows as failed instead of delivered.
- A text message that was delivered but kept showing the sending clock now corrects itself after about 40 seconds; Messenger and Instagram sends give up on Meta after 20 seconds instead of waiting indefinitely.
- Clicking an Analytics section tab, or focusing a hidden control, could slide the whole app up so the sidebar logo and top bar disappeared.
- The app no longer stretches wider than a phone screen when a page has wide content.
- The manage page says that an overdue request alerts everyone who has VerzChat open.

### Upgrade notes
- **Database migrations (3):** `20261024120000_reply_deadline_setting` adds one column with a default. `20261025190000_ai_credit_reservations` adds a new table and a column on `ai_credit_transactions`. `20261026120000_preserve_legacy_schema_values` copies values between legacy columns and is the only one that touches existing rows. Take a backup first; the production deploy does not rehearse a restore or provide a rollback.
- **Messenger replies sent outside VerzChat** need `message_echoes` subscribed in the Meta app's webhook settings, `FACEBOOK_APP_ID` set on the backend, and each Page reconnected once in Channels.
- No other new settings.

## [2.7.0] - 2026-10-24

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
- Every signed-in page now uses one page-title size, one status palette (green, amber, red, blue, purple) and shared buttons, cards and empty states. Status colours are readable in dark mode, the sidebar highlights only the page you are on, and icon-only controls have names and a visible keyboard focus. The legal pages and Book a demo use the same header and footer as the home page, so their links work from any page.
- Rebuilt the marketing landing page with a new visual identity: an owner-first story (who answers a customer at 9 pm), an illustrative inbox, honest channel status, and a pricing table generated from the real plan limits. Removed the old landing components, the unverified partner claim in the social preview image, and the fake social proof.

### Added
- Platform admin endpoints: `GET /platform-admin/attention`, `/growth` and `/users/:id`, and filters on tenants, users, audit log, payments and credit wallets. No database changes.
- `GET /analytics/intelligence` (admin only): the aggregated data behind the new page. No database changes.

### Fixed
- A message that failed to send no longer counts as the first reply to a customer, so median first-reply times in Analytics and the Dashboard are no longer too fast for workspaces with failed sends.
- Dashboard `days` parameters on the legacy endpoints used by the mobile app are now bounded (1 to 90).
- The Dashboard scrolls, and Analytics no longer scrolls into a blank page at the end.
- Billing shows an error with a retry button instead of a blank page when its data fails to load.

## [2.6.0] - 2026-10-23

### Added
- Messenger and Instagram now do what WhatsApp does in the inbox:
  - Media you send (images, video, audio, documents on Messenger) is uploaded to Meta directly, so it no longer fails
    when Meta cannot fetch the file from our server. Voice notes are converted so they play.
  - Replying to a message quotes it.
  - Delivered and read ticks update (Messenger: delivered and read; Instagram: read).
  - Chatbot flows, automations and Verz AI now run on inbound messages, with plain-text replies.
  - Options Meta does not support (location, contact cards, and documents on Instagram) are hidden in those chats.

### Fixed
- The contact details panel shows "Messenger user" / "Instagram user" instead of "Unknown".
- Messenger and Instagram contacts are now named from the Page's conversation list when Meta refuses the direct
  profile lookup (it needs a permission the app may not have yet). The log line says which route failed and why.

### Upgrade notes
- **Meta setup for ticks:** delivered and read ticks need `message_deliveries` and `message_reads` (and, for Instagram,
  `messaging_seen`) subscribed in the Meta app's webhook settings.
- **Names:** Messenger and Instagram contacts are named from Meta when they next write in. If Meta refuses, the server
  log says why.
- **Customers outside your own team** can use Messenger and Instagram only after Meta's App Review (Advanced access).
- No new settings and no migration.

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
