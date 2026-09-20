# WhatsApp via QR (unofficial linked-device connection)

This service connects a real WhatsApp account to Verz the same way WhatsApp
Web does — by scanning a QR code to link a device — using
[Baileys](https://github.com/WhiskeySockets/Baileys), a WebSocket
implementation of the WhatsApp Web multi-device protocol.

**This is not the official WhatsApp Business Platform/API.** It sits
alongside the official Cloud API integration (`WhatsAppNumbersService` /
`WhatsAppNumber` model in `apps/backend`) as a second, independent channel
type (`ChannelType.WHATSAPP_WEB`), never mixed with it. Connecting a number
this way carries a real risk: WhatsApp can restrict or disconnect
linked-device sessions it deems automated, without notice. The frontend
requires explicit risk acknowledgement before showing a QR (see
`WhatsAppQrModal` in `apps/frontend/src/app/(dashboard)/channels/page.tsx`).

## Architecture

```
Meta/WhatsApp (real servers)
        ↕ WebSocket (Baileys)
apps/whatsapp-web  (this service, one long-lived process)
  session-manager.ts   -- one Baileys socket per connected WhatsAppWebSession
  auth-state-store.ts  -- encrypted auth state persisted in Postgres
  index.ts             -- tiny internal-only Express API + startup/shutdown
        ↕ internal HTTP (x-internal-api-key header)
apps/backend
  whatsapp-web.controller.ts          -- public API (pairing, status, disconnect, logout)
  whatsapp-web.service.ts             -- owns the Channel/WhatsAppWebSession DB rows,
                                          calls this service over internal HTTP
  whatsapp-web-internal.controller.ts -- receives QR/status/inbound-message events
                                          posted back by this service
  messages.service.ts:handleInboundWhatsAppWeb()
                                       -- shared contact/conversation/message
                                          pipeline, same one every other
                                          channel uses
```

`apps/backend` never talks to Baileys directly, and `apps/whatsapp-web` never
touches the Inbox/AI/automation pipeline directly — the only thing that
crosses the boundary is a small internal HTTP API, deliberately unreachable
from outside the Docker network (no nginx route to it).

## Why a separate service, not a slot inside `apps/worker`

Every job in `apps/worker` is a short-lived, stateless BullMQ job. A WhatsApp
session needs a persistent, in-memory socket held open for the account's
entire connected lifetime — architecturally foreign to that model. Nothing
else in this codebase manages a comparable long-lived stateful connection
per tenant, so this got its own service rather than being forced into an
existing one.

## Session lifecycle

```
QR_PENDING → CONNECTING → CONNECTED
QR_PENDING → QR_EXPIRED            (QR never scanned before Baileys gave up refreshing it)
CONNECTED  → RECONNECTING → CONNECTED   (transient drop, bounded exponential backoff)
CONNECTED  → RECONNECTING → ERROR       (exceeded RECONNECT_MAX_ATTEMPTS)
CONNECTED  → LOGGED_OUT                 (unlinked from the phone, or explicit Logout)
```

Status lives on `WhatsAppWebSession.status` (a plain string, not a Prisma
enum, so a new transient status doesn't need a migration) and is pushed to
the frontend via the existing realtime infrastructure
(`SocketEvent.WHATSAPP_WEB_STATUS`/`WHATSAPP_WEB_QR`) — no polling.

**Disconnect vs. Logout** are deliberately different operations:
- **Disconnect** (`POST /channels/whatsapp-web/sessions/:id/disconnect`) ends
  the local socket but keeps the linked-device pairing on WhatsApp's side —
  reconnecting later doesn't require a fresh QR scan, as long as the phone
  hasn't unlinked it independently.
- **Logout** (`POST /channels/whatsapp-web/sessions/:id/logout`) fully
  unlinks the device. `encryptedAuthState` is wiped, and reconnecting
  requires scanning a brand new QR.

## Reconnection

Bounded exponential backoff: `RECONNECT_BASE_DELAY_MS` (2s) doubling up to
`RECONNECT_MAX_DELAY_MS` (5min), capped at `RECONNECT_MAX_ATTEMPTS` (10)
before giving up and marking the session `ERROR`. Never an infinite
aggressive retry loop.

A close event on a session that **never successfully connected even once**
(the QR was shown but never scanned) is treated as `QR_EXPIRED`, not
`RECONNECTING` — there's nothing to reconnect to, since auth never
completed. The user has to start a fresh pairing attempt from the Channels
page to get a new QR.

## Session persistence (survives restarts/redeploys)

Auth state is **encrypted and stored in Postgres**
(`WhatsAppWebSession.encryptedAuthState`, via the existing
`CredentialsEncryptionService`) through `PostgresAuthStateStore` — not
written to files inside the container. On startup,
`SessionManager.restoreConnectedSessions()` reconnects every session that
was `CONNECTED`/`RECONNECTING` before the last shutdown, so a redeploy
doesn't force every customer to re-scan their QR.

## Single-owner session lease (no duplicate sessions)

If this service were ever scaled beyond one replica, two instances must
never run the same WhatsApp session's socket concurrently — that would
cause duplicate inbound message processing and an unstable, repeatedly
kicked Baileys connection (WhatsApp only tolerates one active connection per
linked device).

`WhatsAppWebSession.ownerInstanceId` / `lockHeartbeatAt` implement a simple
Postgres-based lease (chosen over a Redis lock since this service already
depends on Postgres and nothing else, and a lease naturally expires if a
process dies — no separate cleanup mechanism needed):

- `SessionManager.connect()` atomically claims the lease via a conditional
  `UPDATE ... WHERE ownerInstanceId IS NULL OR ownerInstanceId = <self> OR
  lockHeartbeatAt < now() - 45s` before opening a socket. If the update
  affects zero rows, another instance already holds it, and this instance
  backs off without connecting.
- A 15-second heartbeat renews the lease for every session this instance is
  actively holding a socket for.
- Graceful shutdown (`SIGTERM`/`SIGINT`) releases every lease this instance
  holds immediately, so a normal redeploy doesn't leave sessions stranded
  for the 45-second staleness window before they're reclaimed.
- **Known tradeoff**: an *ungraceful* crash (not a clean shutdown) does not
  release the lease, so the restarted process — which gets a fresh random
  `INSTANCE_ID` — has to wait out the 45-second staleness window before it
  can reclaim its own former sessions. This is the standard behavior of a
  lease-based ownership pattern (the same tradeoff etcd/Consul/Kubernetes
  leader-election leases make): correctness (never two owners at once) is
  prioritized over instant self-recovery from a hard crash.

## Multi-account isolation

Every `WhatsAppWebSession` belongs to exactly one `Channel`, which belongs
to exactly one tenant. `WhatsAppWebService` scopes every query by
`{ id, tenantId }` — a session ID from another tenant simply doesn't match
and resolves to "not found," never another tenant's data. A tenant can
connect multiple numbers; `Channel.externalId` (backfilled with the
connected phone number the first time it's reported) disambiguates them,
the same pattern Facebook Messenger already uses for multiple connected
Pages.

## Message flow

**Inbound**: Baileys `messages.upsert` → `handleInboundMessage()` parses the
payload (text/media/caption) → POSTs an `inbound_message` event to
`apps/backend`'s internal endpoint → `MessagesService.handleInboundWhatsAppWeb()`
resolves/creates the contact and conversation (same `ContactsService`/
`ConversationsService` every other channel uses), persists the message, and
dispatches AI/chatbot exactly like any other inbound message. Deduplicated
by `Message.whatsappMessageId` — a duplicate/retried event is a no-op, with
a second-layer safety net via the database's unique constraint in case two
concurrent requests race past the initial check.

**Outbound**: an Inbox reply on a `WHATSAPP_WEB` conversation goes through
`MessagesService.dispatchOutbound()`'s existing branch for this channel
type, which calls `WhatsAppWebService.sendText()`/`sendMedia()` — these
call this service's `/sessions/:id/send-text`/`/send-media` endpoints,
requiring the session to be `CONNECTED` first.

## Security

- Auth credentials are encrypted at rest (`CredentialsEncryptionService`,
  the same one used for the official Cloud API's access tokens) and never
  returned in any API response.
- `WHATSAPP_WEB_INTERNAL_API_KEY` authenticates the internal HTTP traffic
  between this service and `apps/backend` in both directions
  (`x-internal-api-key` header). **Must be set in production** — if unset,
  `InternalApiKeyGuard`/this service's own `requireInternalKey` middleware
  fail *open* with a loud warning (matches this codebase's established
  pattern for secrets that must ship before they're fully provisioned
  everywhere), which is fine for a brand-new environment but should not be
  left unset indefinitely on a production deployment, since anything else
  reachable on the internal Docker network could otherwise call these
  routes.
- Never exposed through nginx — only reachable from `backend`/`worker` on
  the internal Docker network.
- No auth state is ever written to disk inside the container (Postgres
  only), so there's no `.auth_info`-style directory to `.gitignore` or
  accidentally leak via a container filesystem dump.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Same Postgres database as `apps/backend` |
| `BACKEND_INTERNAL_URL` | no | `http://backend:3001` | Where internal events are POSTed |
| `WHATSAPP_WEB_INTERNAL_API_KEY` | should be set in production | `''` (fails open if unset) | Shared secret with `apps/backend` |
| `CREDENTIALS_ENCRYPTION_KEY` | yes | — | Same key `apps/backend` uses for encrypting stored credentials |
| `PORT` | no | `3004` | |
| `LOG_LEVEL` | no | `warn` | pino log level; set to `info`/`debug` for live Baileys connection troubleshooting |

## Deployment

Runs as its own container (`apps/whatsapp-web/Dockerfile`), alongside
`worker`/`realtime` in both `infra/docker-compose.yml` and
`infra/docker-compose.staging.yml`. Not exposed through nginx. Should run as
exactly one replica (see "Single-owner session lease" above for what
happens if that's ever changed).

## Troubleshooting

- **Every connection attempt fails with a generic "Connection Failure"
  during the noise handshake**: WhatsApp rejects a stale protocol version.
  `connect()` calls `fetchLatestBaileysVersion()` before opening the socket
  specifically to avoid this — if it's happening again, check whether that
  call itself is failing (falls back to the Baileys package's baked-in
  default version, which can go stale between Baileys releases).
- **QR verifies but no message ever arrives, or a session sits in
  `QR_PENDING` forever with no logs**: check the internal event route --
  events are POSTed to `{BACKEND_INTERNAL_URL}/api/v1/internal/whatsapp-web/events`
  (the `/api/v1` prefix is easy to miss and was a real, previously-shipped
  bug here; `main.ts`'s `app.setGlobalPrefix('api/v1')` applies to every
  backend route, including internal ones).
- **A session never reconnects after a redeploy**: check
  `docker logs <whatsapp-web container>` for a lease-claim warning
  ("could not claim WhatsApp Web session lease") — if the previous
  container didn't shut down gracefully, the new one has to wait out the
  45-second staleness window.
- Set `LOG_LEVEL=info` (or `debug`) temporarily to see Baileys' own
  connection-lifecycle logs (`connected to WA`, `not logged in, attempting
  registration...`, etc.) — the default `warn` level hides these.

## Limitations

- Unofficial: subject to WhatsApp restricting or disconnecting the linked
  device at any time, without notice, outside Verz's control.
- Runs as a single instance today; the session lease (above) makes scaling
  to multiple replicas *safe* but does not itself add horizontal capacity —
  a given session still only ever runs on one instance.
- Media types beyond image/video/audio/document (e.g. location, contact
  cards, voice-note-specific handling) are not yet implemented.
- No automated `/subscribed_apps`-style setup step exists for this
  connection type since it's not applicable to the linked-device protocol
  (unlike the official Cloud API, there's no separate Meta-side webhook
  subscription to configure).
