# TikTok contract verification (2026-11-04)

What was checked against TikTok's own published documentation, what was not, and what changed as a result. **Nothing here is a test against TikTok**: every item is a reading of a documentation page. No request was sent to TikTok, and no TikTok account, app review or approval was used.

Method: the pages under `developers.tiktok.com/doc/` could be fetched and read. The Business API portal (`business-api.tiktok.com/portal/docs`) renders its text in the browser and could not be read by the tools used, so its content is still only known through search-index excerpts and integrators' reports.

## A. Login Kit (account connection, token refresh): verified
| Claim in our code | Source read | Result |
|---|---|---|
| Access token lives about 2 hours; the refresh job renews it ahead of expiry | OAuth user access token management | matches (2 hours) |
| Refresh token lasts 180 days and **rotates**: every refresh returns a new one, reusing an old one fails | same page | matches; the stored pair is replaced with compare-and-set, and a rejected refresh marks the account "reconnect needed" |
| `expires_in` / `refresh_expires_in` are remaining seconds | same page | matches |
| Token, refresh and revoke are called from the server with the client secret | same page | matches |
The Business API's 24-hour token (messaging) is a **different product** and is kept separate in code (`kind: business_messaging`).

## B. Content Posting API (publishing): verified from documentation, then corrected
Pages read: Direct Post reference, Query Creator Info, Get Video Status, Media Transfer Guide.
| Item | Before | Documentation says | Change |
|---|---|---|---|
| Endpoints, headers, `post_info`/`source_info` fields, `FILE_UPLOAD` fields | as documented | same | none |
| Pre-flight | none | the creator-info query is part of the flow: it gives `privacy_level_options`, the creator's comment/duet/stitch settings, and posting limits (returned as **HTTP 200** with a non-ok code) | **added**: the post stops with a clear message before uploading if the visibility is not allowed or a limit applies; comment/duet/stitch follow the creator's settings |
| Brand toggles | missing | `brand_content_toggle` is required, `brand_organic_toggle` accompanies it | **added** (both false: this app never posts branded content) |
| Chunk rules | single chunk up to 64 MB, else 10 MB chunks, final absorbs the rest | 5-64 MB chunks, final up to 128 MB, `total_chunk_count = floor(size / chunk_size)`, 1 to 1000, under 5 MB in one chunk | matches (and fixed earlier: a 5-10 MB file no longer plans zero chunks) |
| Chunk response codes | any 2xx accepted; client errors retried | 206 = more to come, **201 = complete**; 5xx retry; 400/403 (expired address)/404/416 are not retryable | **fixed**: the last chunk must answer 201 or the post is failed, and only 5xx/network errors are retried |
| Error codes | some undocumented codes in the lists | the documented set (`access_token_invalid`, `scope_not_authorized`, `rate_limit_exceeded`, `internal_error`, `spam_risk_too_many_posts`, `spam_risk_user_banned_from_posting`, `reached_active_user_cap`, `unaudited_client_can_only_post_to_private_accounts`, `privacy_level_option_mismatch`, `url_ownership_unverified`, `invalid_param`) | **trimmed to the documented set**; 5xx is retryable |
| `fail_reason` | passed through | 11 documented values with retry guidance | **mapped to plain language**; `auth_removed` ends the post with reconnect advice (it can never complete), `internal` is the only retryable reason |
| Status values | as documented | `PROCESSING_UPLOAD`, `PROCESSING_DOWNLOAD`, `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, `FAILED` | matches; `publicaly_available_post_id` (sic) is absent for a private post and is handled |
| Rate limits | not modelled | init 6/min, status 30/min, creator info 20/min per user token | handled as `rate_limit_exceeded` with backoff; per-account throttling is not implemented (low volume) |
| Unaudited apps | visibility limited to "Only me" | same | matches |
Still true: real posting needs the Content Posting API product on the TikTok app, `video.publish` granted by each account, and TikTok's audit to go public. **Not run against TikTok.**
Webhooks for Content Posting (post.publish.* events) exist but are **not used**: status is polled. The events page could not be read, so no handler was written from guesswork.

## C. Webhook signature: partly verified
TikTok's webhook verification page (read) states: header `TikTok-Signature: t=<timestamp>,s=<signature>`; signed string is the timestamp, a `.`, then the raw JSON body; HMAC-SHA256 keyed with the **client secret**; reject timestamps that are too old. The page gives no tolerance window and does not state the digest encoding (its example is lowercase hex).
* Our Business Messaging verifier implements exactly that scheme with the Business app's secret. It is now `secondary` (official for TikTok developer webhooks; the same layout is reported for Business Messaging, whose own page was unreadable).
* Tolerance changed from 5 s to **300 s**: TikTok states no window, 5 s risks rejecting legitimate or redelivered events, and replays are harmless because every message is de-duplicated by its id.

## D. Business Messaging API: still unverifiable from documentation
Unchanged and still disabled by default behind three switches. Still `assumed`: the send, upload, download, conversation-list, message-list, webhook-update, token and refresh paths; request/response field names; the webhook event payload; the authorisation URL. Still `official`: the host and `/open_api/v1.3/` prefix, the webhook-list endpoint, event type `DIRECT_MESSAGE`, users must write first, access needs approval and privacy/security reviews. Still `secondary`: 48 h window, text or one JPG/PNG under 3 MB, event names, region and account-type limits.
**What would resolve it:** an operator opening the portal pages in a browser (or exporting the OpenAPI/API reference TikTok provides after approval) and checking each `assumed` item in `tiktok-messaging.contract.ts`, then a sandbox exchange with an approved app. Until then `TIKTOK_MESSAGING_CONTRACT_CONFIRMED` must stay unset.
