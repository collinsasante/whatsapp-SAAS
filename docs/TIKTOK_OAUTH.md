# TikTok channel: OAuth connection (Login Kit v2)

Status 2026-11-04. Scope of the channel today, as the product states it: **account verification** through Login Kit (`user.info.basic`). Business Messaging and DM automation are not implemented, and TikTok publishes no third-party messaging API (see "Not built, and why").

## Root cause of "TikTok token exchange failed: unknown"

`ChannelsService.connectTikTok` parsed TikTok's token response as `{ data: { access_token, ... }, error: { code: 'ok' } }`. That envelope belongs to TikTok's Content/Display APIs (for example `/v2/user/info/`). The OAuth token endpoint (`POST https://open.tiktokapis.com/v2/oauth/token/`, form-encoded) answers with a **flat** object:

* success: `access_token, expires_in, refresh_token, refresh_expires_in, open_id, scope, token_type`
* failure: `error` (a string such as `invalid_grant`), `error_description`, `log_id`, with **HTTP 200**

So the code's check (`error?.code !== 'ok' || !data?.access_token`) was true for every response, a success included, and the message fell through to `'unknown'`. The connection could never have succeeded and TikTok's real reason was always hidden. Nothing was logged either: the controller only redirects to `/channels?error=...`.

Evidence (2026-11-04): an invalid code sent from the staging backend with the staging app's own credentials returned HTTP 200 `{ "error": "invalid_grant", "error_description": "Authorization code is expired.", "log_id": "..." }` (top-level keys `error, error_description, log_id`). That also shows the staging client key and secret are **accepted** by TikTok (a bad key would answer `invalid_client`). The user's console message exists only when our callback received a `code` and a valid signed `state` and then tried the exchange, so the browser redirect, the signed state and the callback route all work; the failure was after them.

Sources read: TikTok for Developers, "Get a user access token", "Refresh a user access token", "Revoke a user access token", "Login Kit for Web", "Get user info", "Scopes". The contract above was confirmed with a live call, not only from the documents.

## What changed (branch `fix/tiktok-oauth-token-exchange`)

| Area | Change |
|---|---|
| Token exchange | Reads the real flat contract; failures become `TikTok authorization failed [invalid_grant]: Authorization code is expired. (TikTok ref <log_id>)`, shown in the dashboard toast and logged server-side (tenant, HTTP status, error code, description, log id, redirect URI). Request timeout 10 s; network failure gives a retry message. |
| Secrets | The authorization code, `state`, tokens and the client secret are never logged; TikTok-supplied text is sanitised (bearer-looking tokens and `key=value` secrets redacted, control characters stripped, length capped). Asserted by tests. |
| Storage | `accessToken` and `refreshToken` are stored **encrypted** (`CredentialsEncryptionService`, the same AES-GCM used for Facebook and Instagram); previously they were plaintext JSON. They never leave the server in API responses (`toPublicChannel`). Stored with the tenant from the signed state. Granted scopes, `tokenExpiresAt` and `refreshExpiresAt` are kept. |
| Refresh | Worker job `tiktok-token-refresh` (every 10 min) refreshes tokens with under 30 min left. TikTok refresh tokens **rotate**, so both are stored; the write is compare-and-set on the old refresh token. `invalid_grant` (revoked, expired or rotated away) sets `metadata.tiktokAuth.status = REAUTH_REQUIRED` and the dashboard shows "Reconnect needed"; network or 5xx failures are retried on the next pass. |
| Disconnect | Best-effort `POST /v2/oauth/revoke/` (never blocks the disconnect, result logged) and **every stored token is deleted**; a disconnected account with history keeps only its identity so a reconnect matches it. |
| Reconnect | Same `open_id` updates the existing channel and re-activates it (no duplicate). |
| Frontend | `decodeURIComponent` of an already-decoded value could throw on a `%` in a TikTok description; made safe. |

Lifetimes are read from `expires_in` / `refresh_expires_in`, never hard-coded (the docs say about 2 hours and 180 days).

## State, redirect URI and scopes
* State: HMAC-SHA256 signed payload `{ tenantId, provider, userId, exp }`, 5-minute expiry, constant-time compare, verified in the public callback; the initiating route requires `ADMIN` or `SUPER_ADMIN`. Signed with `OAUTH_STATE_SECRET`, **falling back to `JWT_SECRET`** (on staging `OAUTH_STATE_SECRET` is unset). A dedicated secret is recommended (changing it invalidates in-flight states only).
* Redirect URI sent to TikTok: `${API_URL}/channels/oauth/tiktok/callback`, on staging `https://staging.verzchat.com:8443/api/v1/channels/oauth/tiktok/callback`. TikTok requires it to match a URI registered for the app (https, static, no query or fragment, under 512 characters, at most 10). Because TikTok's authorize step accepted it and redirected back to our callback, it is registered for the staging app; **the production redirect URI must be registered separately in the TikTok developer console before production use**.
* Scope requested: `user.info.basic` only (identity). Posting needs additional scopes (below).

## The console messages
| Message | Owner | Evidence |
|---|---|---|
| `TikTok token exchange failed: unknown` | VerzChat (the bug above) | fixed |
| Report-only CSP script and frame violations | **TikTok's pages** | `www.tiktok.com/v2/auth/authorize/` itself sends `Content-Security-Policy-Report-Only` (with `script-src ...` and `frame-src 'self' tiktok.com`) and reports to TikTok's own monitoring endpoints. VerzChat staging sends **no** CSP at all; the production nginx sends one enforced CSP and no report-only one. Loading TikTok's login page cold in headless Chrome reproduces dozens of "upgrade-insecure-requests is ignored when delivered in a report-only policy" messages with none of our code involved. DevTools shows them next to ours when "Preserve log" is on. Observations, not blockers; **our CSP was not changed**. |
| Successful CDN service-worker probes | TikTok's login page | reproduced in the same load (`CDN SW ... Probe success`) |
| "Another JSB SDK has already been used" | TikTok's authorization/consent page | VerzChat loads no TikTok, ByteDance or JSB script anywhere (searched the frontend and nginx config); not reproduced on the pre-login page, so it comes from the post-login consent page that this session cannot render without an account |
| Failed `bytedance://dispatch_message/` launch | TikTok's page trying to open the TikTok desktop/mobile app | `bytedance:` is in TikTok's own CSP `default-src`; the web OAuth path is plain HTTPS redirects, and our callback received the `code`, so this does not affect web OAuth. An unavailable app handler fails harmlessly |

No SDK was removed or changed because none of them is ours.

## Not built, and why
* **Publishing:** nothing in the repository posts to TikTok. TikTok's Content Posting API needs the `video.publish` scope (or `video.upload` for drafts) approved for the app, and posts from an **unaudited** client are restricted to private visibility until TikTok audits the client; media pulled by URL must come from a verified domain or URL prefix. These are TikTok developer-console and review matters. Building and shipping posting code that cannot be exercised without those approvals would be speculation, so it is not included.
* **Messaging:** TikTok documents no public Business Messaging or DM send/receive API for third parties (its only DM-related scopes are Data Portability exports). The dashboard already says Business Messaging depends on TikTok's own approval.

## What still needs a person
1. The TikTok developer console: confirm the staging redirect URI above is registered (it evidently is), register the production one, and request `video.publish` plus an audit when posting is wanted. This session changed nothing there.
2. A real connection test: clicking "Continue with TikTok" on staging needs a TikTok account login, which cannot be automated. Procedure after the fix is deployed: connect, then watch `docker logs wa_staging_backend` (a successful connection logs `TikTok account connected for tenant ...`; a failure now logs the TikTok error code, description and `log_id`), check the channel row (tokens `enc:v1:` prefixed), wait for a refresh pass (`[TikTokTokenRefresh]` in the worker log), then disconnect and confirm the revoke line and that the stored credentials hold no tokens.

## Verification performed
* 87/87 channel tests, including 11 new service tests, 16 parser tests, 8 refresh-cycle tests; the service tests fail 9 of 11 against the original code (mutation check). The suites use the exact error body captured live from TikTok.
* Type checks: backend, worker and frontend 0 errors.
* Not yet done: deployment to staging and a real TikTok login (see above).
