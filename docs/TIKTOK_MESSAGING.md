# TikTok Business Messaging

TikTok has an official Business Messaging API (conversation list, message retrieval, sending, image upload/download, webhooks). This adapter implements it
end to end. **It has never talked to TikTok.** It is disabled by default and cannot be enabled by accident.

An earlier note in this repository said TikTok messaging was impossible. That was wrong and is withdrawn.

## What is implemented (code: `apps/backend/src/tiktok-messaging/`)
* Connection: signed-state authorisation flow, tokens stored encrypted, a business account can belong to one workspace at a time.
* Inbound: signature-verified webhook -> normalise -> de-duplicate (`tt:<account>:<message id>`) -> contact, conversation, unread, realtime inbox, chatbot/AI (same path as Messenger and Telegram). Images are downloaded and stored; stickers, shared posts and unknown types are labelled.
* Echoes: a reply typed in the TikTok app is stored as an external outbound message; our own sends are not stored twice.
* Outbound: text (6000 characters) and one JPG/PNG image under 3 MB (upload, then send; a caption goes as its own text because TikTok rejects mixed content); the 48-hour reply window is enforced before sending; rate limits and 5xx are retried, a lost answer is **not** (the message may be delivered) and the agent is told to check TikTok.
* Tokens: access token renewed on use, rotating pair stored with compare-and-set; a rejected refresh marks the account "reconnect needed". The Login Kit refresh worker ignores these connections, and posting refuses them.
* History: on-demand silent backfill (no alerts, no unread, no AI), idempotent, bounded (200 conversations, 500 messages each).
* Webhook registration: platform operators only (`POST /tiktok/messaging/webhook/register`), HTTPS only.
* UI: a Messages section on the TikTok card, shown only where the feature flag is on, listing exactly what is still missing.
* Tenant isolation: the workspace is derived from our stored record of the receiving account; an account connected to two workspaces is refused at connect time and its events are dropped if it ever happens.

## The three switches (all must be on)
1. Feature flag `tiktok_messaging` for the workspace.
2. `TIKTOK_BUSINESS_APP_ID` / `TIKTOK_BUSINESS_APP_SECRET` (the TikTok for Business app, not the Login Kit client key).
3. `TIKTOK_MESSAGING_CONTRACT_CONFIRMED=true`, set by an operator **only after** checking every item below against the portal and a sandbox exchange.

## What was and was not confirmed
TikTok's reference pages are rendered client-side and could not be read. Every wire detail is tagged in `tiktok-messaging.contract.ts`:

| Provenance | Items |
|---|---|
| official (TikTok docs) | host and `/open_api/v1.3/` prefix, the webhook-list endpoint, event type `DIRECT_MESSAGE`, users must write first, HTTP 200 required from the webhook, access needs approval and privacy/security reviews |
| secondary (Chatwoot, Infobip; the signature scheme is also official for TikTok developer webhooks) | signature header `TikTok-Signature: t=..,s=..` signed over `<t>.<raw body>` with HMAC-SHA256 and the app secret, failure = HTTP 200 with non-zero `code`, 48 h window, 6000 chars, text or one JPG/PNG < 3 MB, event names, business accounts only, blocked regions, 24 h access token |
| **assumed** | the send, upload, download, conversation-list, message-list, webhook-update, token and refresh paths; request and response field names; the webhook payload layout; the authorisation URL; the 300 s replay tolerance (TikTok states none) |

The tests use these assumptions as fixtures. They prove our behaviour, not TikTok's.

## What TikTok must grant (human, outside the code)
The same list the status endpoint shows (`GET /tiktok/messaging/status`):
1. A TikTok for Business developer app with Terms of Service and Privacy Policy URLs.
2. Business Messaging API access approved for that app (application, data security and privacy reviews).
3. The "TikTok Accounts" permission enabled under Scope of permission.
4. The redirect URL (`<API_URL>/tiktok/messaging/callback`) registered on the app, and a public HTTPS webhook URL (`<PUBLIC_URL>/api/v1/webhook/tiktok-messaging`) that answers 200.
5. A TikTok Business Account outside the EEA, Switzerland and the UK, accepting direct messages.

If access is not granted, the feature stays off and the panel says which item is missing. Nothing is simulated, and no unofficial or private API is used.

## Verification procedure once TikTok grants access (after the AP-3 gate)
1. Read the portal pages for each `assumed`/`secondary` item; correct `tiktok-messaging.contract.ts` and the client/normaliser where they differ; update the fixtures; re-run the tests.
2. Set the three switches on staging only. Register the webhook (`webhook/register`), confirm `confirmedByTikTok`.
3. Connect a test business account; send a message from a second TikTok account; confirm it appears once; reply; confirm delivery on TikTok; send an image both ways; confirm the echo of a reply typed in the app; import history.
4. Only then record "real-integration verified" in `docs/CHANNEL_CAPABILITY_MATRIX.md`.
