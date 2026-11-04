# Telegram on staging: webhook route assessment (2026-11-04)

Public staging address: `https://staging.verzchat.com:8443`. Read from the repository and public DNS only; **nothing was contacted and no VPS, firewall or container setting was changed** (AP-3 hold).

## The path a Telegram delivery takes
`Telegram -> https://staging.verzchat.com:8443/api/v1/webhook/telegram/<channelId>` -> Cloudflare edge (the name resolves to Cloudflare addresses, so it is proxied) -> origin host port 8443 -> `wa_staging_nginx` container port 443 (`infra/docker-compose.staging.yml`: `"8443:443"`) -> `location /api/` -> `backend:3001` -> global prefix `api/v1` -> `TelegramWebhookController` (`webhook/telegram/:channelId`).

Not the internal 8080: that is the plain-HTTP server block and Telegram requires HTTPS.

## Checks against the repository
| Item | Result |
|---|---|
| Port | 8443 is one of the four ports Telegram supports (443, 80, 88, 8443). Cloudflare also proxies 8443. |
| Webhook URL built by the app | `PUBLIC_URL` is `STAGING_PUBLIC_URL` (`https://staging.verzchat.com:8443`, `.env.staging.example`), so the URL registered with `setWebhook` is `https://staging.verzchat.com:8443/api/v1/webhook/telegram/<id>`: correct. |
| Path routing | nginx `/api/` -> backend; the controller path matches. |
| Secret header | `X-Telegram-Bot-Api-Secret-Token` passes through nginx (hyphenated header, no underscore rule). |
| Body | JSON; `client_max_body_size 512M`, no impact. |
| Certificate | Cloudflare presents its own public-CA certificate to Telegram (valid for a first-level subdomain under the zone). The origin certificate (`fullchain.pem`, Let's Encrypt) matters for Cloudflare's origin connection, not for Telegram. A self-signed upload to Telegram is not needed. |
| IPv4 | Telegram connects over IPv4 only; the name has IPv4 addresses (Cloudflare), so the VPS's periodic IPv6 stall does not affect it. |
| Firewall | The `inet staging8443` gate allows only Cloudflare's published ranges (plus an expiring admin exception) on 8443. Telegram's servers reach Cloudflare, and Cloudflare reaches the origin from its ranges, so the gate **does not need to change**. |
| Throttling | The webhook is `@SkipThrottle`; Telegram retries until it gets 2xx and messages are de-duplicated. |

## Risks that cannot be checked without contacting staging or Cloudflare
1. **Cloudflare security rules** (Bot Fight Mode, WAF managed challenge, rate limiting) can challenge or block Telegram's POSTs. If `getWebhookInfo` later shows `last_error_message` such as a 403, add a WAF skip rule for `/api/v1/webhook/telegram/*`. This is a Cloudflare dashboard change, not a VPS change.
2. The live certificate chain served at the edge and whether the `fullchain.pem` on the origin is current: confirm after the gate.
3. That the staging stack is serving the new backend (the route exists only after the candidate is deployed).

## Checks to run after the AP-3 gate passes (read-only first)
1. `dig +short A staging.verzchat.com` (expect Cloudflare IPv4); `openssl s_client -connect staging.verzchat.com:8443 -servername staging.verzchat.com </dev/null` and read the chain.
2. `curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://staging.verzchat.com:8443/api/v1/webhook/telegram/00000000-0000-0000-0000-000000000000` -> expect **404** (route reached, unknown channel).
3. Connect a real test bot in Channels. Then, from a shell where the bot token is in an environment variable (never typed into history or printed): `curl -sS "https://api.telegram.org/bot$TOKEN/getWebhookInfo"` -> expect the URL above, `pending_update_count` 0, no `last_error_message`.
4. Send the bot a message and a photo; confirm they appear once; reply; confirm delivery.
