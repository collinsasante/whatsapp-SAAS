# TikTok publishing

Status: implemented and tested against a **mocked** TikTok API. It has never posted to a real TikTok account. It is off by default.

## What it does
Admins pick a video and a caption on the TikTok card in Channels. The video is queued, sent to TikTok with the Content Posting API (Direct Post, `FILE_UPLOAD`, chunked), and its status is followed until TikTok reports it posted or failed. Code: `apps/backend/src/tiktok-publishing/`; table `tiktok_publications` (migration `20261107120000_tiktok_publications`).

## Switches (all default to off or the safest value)
| Switch | Effect |
|---|---|
| Feature flag `tiktok_publishing` (per workspace, Feature flags admin) | No flag row, or disabled: the API answers 403, the UI panel is hidden, the runner leaves queued posts untouched. |
| `TIKTOK_REQUEST_PUBLISH_SCOPE=true` | The connect URL also asks for `video.publish`. Set only after the scope is added to the TikTok app, or TikTok refuses every sign-in. Accounts connected earlier must reconnect to grant it; posting is refused with a clear message until they do. |
| `TIKTOK_PUBLISH_ALLOWED_PRIVACY` (default `SELF_ONLY`) | Visibility levels the app may use. TikTok limits unaudited apps to "Only me". Widen only after the audit. |
| `TIKTOK_PUBLISH_RUNNER=off` | Stops the 30-second runner on that replica. |

## States
`QUEUED` -> `UPLOADING` -> `PROCESSING` -> `PUBLISHED`, or `FAILED`, `NEEDS_RECONNECT`, `CANCELLED`, and `UNCERTAIN`.

## How duplicate posts are prevented
* A unique `(tenant, idempotency key)`: the same submission twice returns the same row. The UI sends one key per submission.
* Every step is claimed with a compare-and-set on status and a lease, so several replicas cannot both send the same post (tested with a stale snapshot race; the test fails if the claim check is removed).
* TikTok's `publish_id` is stored before any bytes are uploaded.
* If TikTok's answer to the initial request is lost (timeout, reset, unparseable), the post is `UNCERTAIN` and is **never retried automatically**; the person must check TikTok and confirm. Only a refusal TikTok actually sent, or a connection that could not be opened, is retried (backoff, 5 attempts).
* A post that TikTok already has is never re-initialised: after a revoked token it resumes status checks only.
* A run that dies mid-upload is recovered after its lease expires: `UNCERTAIN` if TikTok never gave an id, `FAILED` (nothing posted) if it did.

## Tokens
Access tokens are decrypted only in memory. An expired access token makes the post wait for the existing refresh worker (rotating refresh tokens are handled there), without consuming an attempt; a revoked or missing token gives `NEEDS_RECONNECT`.

## Security and audit
Writes need ADMIN or SUPER_ADMIN; reads also AGENT. Every query is scoped to the caller's workspace; the channel and the media key must belong to it. Requests, retries, cancellations and final results are written to the audit log (no tokens).

## Not verified (needs a real account)
Real posting, TikTok's real error codes and status strings (taken from the public documentation), the app review/audit, `video.publish` approval, and behaviour of very large uploads. Run the post-AP-3 sequence with a real account before enabling for anyone.
