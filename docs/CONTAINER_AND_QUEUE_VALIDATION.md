# Container, queue and runtime validation (2026-11-05)

Everything here was run on a laptop against throwaway services. **Nothing was deployed, nothing touched the VPS, staging or production, and no real provider received a request carrying a credential.** Results marked "local" say how our code behaves; they are not staging or provider evidence.

## 1. Release images

Each image was built from the candidate tree with its production Dockerfile and started on an isolated Docker network with a throwaway PostgreSQL (pgvector image) and Redis, using the production start command and `NODE_ENV=production`. Images were removed after each service because the local Docker disk is small.

| Image | Size | Result |
| --- | --- | --- |
| backend | 247 MB | Built. The production `CMD` (`prisma migrate deploy` then `node dist/main`) applied every migration to an **empty** database, the app reported healthy (`/api/v1/health` returned `ok`) and logged **0** error-level lines. Node 20.20, ffmpeg present. |
| worker | 83 MB | Built. Logged `All workers started`. `docker stop` ended it with **exit code 0** inside the 30 s grace period (the new lifecycle, running as the real image). 0 error lines. |
| realtime | 49 MB | Built. Started; `/health` returned `ok`. |
| whatsapp-web | 106 MB | Built. Under the production Node 20 image the **patched Baileys loads music-metadata 11** and a hostile ASF input is rejected cleanly (`CouldNotDetermineFileTypeError`) instead of hanging. Process started. |
| frontend | 93 MB | Built from `642b640` (after freeing local Docker disk by removing two exited build-step containers from earlier failed builds). The actual image runs as `nextjs` (uid 1001) with `NODE_ENV=production`, `PORT=3000`; `/login` and `/register` returned 200, a hashed static asset 200, an unknown path 404; the configured API URL is baked into the bundle; `.next` is writable by the runtime user; 0 error log lines; `docker stop` exit 0. |

The first frontend attempt failed with `no space left on device` on the local Docker VM (shared, 26 GB). After removing two disposable exited build containers (`gifted_saha`, `objective_ellis`, no mounts) and pruning dangling images, the build passed.

**Architecture caveat.** These were built for `linux/arm64` (Apple silicon). They prove the Dockerfile logic, dependency resolution, the patches, migrations and process behaviour. They do not prove the `linux/amd64` native modules (bcrypt, sharp, Prisma engines) that the VPS will run; the first CI or staging build on amd64 is the evidence for that.

### Findings from the image runs

* **Four of five server images run as root** (only the frontend sets `USER`). Not changed here: the backend writes uploads to a mounted volume whose ownership on the VPS I cannot see before AP-3, and a wrong `USER` change there would break uploads at deploy time. Recommended after AP-3 and staging acceptance: `USER node` for worker, realtime and whatsapp-web (stateless, no volume) first, then the backend once the volume ownership is known.
* **`apps/frontend/.next/types` breaks `tsc` if a build has run** in the same tree (generated validator paths). CI type-checks from a clean checkout, so it is unaffected; locally, type-check before building or delete `.next/types`.

## 2. Redis and BullMQ

Run with the worker's own tests (`pnpm --filter @whatsapp-platform/worker test`), which start their own `redis-server` on a free port and run the real workers through real BullMQ, plus the existing backend queue specs against Redis.

| Behaviour | Evidence |
| --- | --- |
| A due job is processed; a job for another tenant's conversation is not touched | worker integration tests |
| Duplicate `jobId` schedules one job, not two; a delayed job does not run early | worker integration tests |
| Concurrency never exceeds the configured limit under a 30-job burst | worker integration tests |
| Graceful stop waits for an in-flight job | worker integration tests; real process: SIGTERM gives exit 0 |
| A failing database makes the job fail and be retried with backoff until it succeeds | worker integration tests |
| A realtime outage does not fail a job | worker integration tests |
| **Redis killed and restarted empty: no crash, no uncaught exception, work resumes** | worker integration tests; also observed directly (processed jobs before, during recovery and after) |
| Startup failure (database unreachable) | **was a defect**: the process logged the error and stayed alive with no workers, so `restart: always` never fired. Now exits 1; verified with the real process and unit tests |
| SIGINT, unhandled rejection, uncaught exception | now stop gracefully, bounded at 25 s; compose gives the worker `stop_grace_period: 30s` |
| AI-learning, digital-self and spend-cap queues on real Redis and PostgreSQL | backend specs, all enabled and passing |

Known limitations, deliberately not changed:

* **Campaign sending is at-least-once across a crash.** The worker only processes `PENDING` recipients and records each result after the HTTP call to Meta. If the process dies between Meta accepting a message and the recipient being marked `SENT`, a stalled-job retry resends that one recipient. The window is a single HTTP call. Closing it needs an in-flight state on `campaign_recipients`, which is a schema change; left for a deliberate migration.
* **The `message-retry` worker has no producer** anywhere in the codebase (only the health monitor references the queue), so it is dormant. It was not extended.
* **Stalled-job recovery** relies on BullMQ's defaults (30 s lock, 30 s stall check). It was not exercised here because that needs a 30 s wait per case.

## 3. Rate limits, uploads and tenant isolation

* **Rate limits were halved by a bug, now fixed.** Endpoints carried `@UseGuards(ThrottlerGuard)` on top of the global guard, so each request counted twice: login 10/min answered 429 after 5, forgot-password 5/min after 2, resend-verification 3/min after 1, public checkout 30/min after 15. Fixed, and an e2e spec pins every declared limit exactly, including client-address handling behind one trusted proxy (a client cannot dodge the limit by forging the left side of `X-Forwarded-For`).
* **Uploads** now require the content to match the declared type (HTML as `image/png`, an ASF container as `audio/ogg`, a script as `text/plain` are refused before storage), enforce per-type ceilings while streaming (images 16 MB, audio 64 MB, documents 100 MB, video 512 MB; previously every type could pin 512 MB of memory), allow one file per request, and answer 400 when no file is sent. File names never influence the storage key; traversal keys on the public serve route are refused; serving sets `nosniff` and forces download for anything not on the inline-safe list. Tenant isolation: another tenant's asset cannot be listed, read or deleted.
* **Provider errors no longer reach the user as our status.** A provider answering 401 (our own missing or expired credential) used to be relayed as 401, which the web app reads as an expired session. Now 502 with a generic message, and Paystack refuses locally with a 503 when no key is configured.

### Check at staging (cannot be checked before AP-3)

* `infra/nginx/nginx.staging.conf` in the repository is HTTP-only on port 80 and has no `real_ip` handling or `limit_req` zones, while the staging docs and compose file describe `8443:443` behind Cloudflare, and production `nginx.conf` does restore the real client IP from Cloudflare. The file on the VPS may differ. If staging really runs this file, every visitor is throttled as one Cloudflare edge address. Confirm the live staging config before acceptance testing rate limits.
* Staging's `trust proxy 1` assumes exactly one proxy hop between the client and the backend (nginx). Cloudflare plus nginx only works if nginx rewrites the client address first (production does).

## 4. Browser journeys (local)

Real Chromium against a production build and a freshly migrated, seeded database (`billing_plans` 5, `ai_credit_packages` 4, three users, three channel states). The setup fails if seed data is missing, so absent seed rows cannot be mistaken for a frontend defect: the e2e suites truncate every table, including rows migrations insert, so a database cloned from the e2e database has no credit packs.

38 of 38 checks passed: sign-in with PIN; billing renders usage, credit state and all four packs with no server error, no page error and no horizontal overflow on desktop or mobile; the checkout dialog validates the receipt email; with no payment provider configured checkout fails visibly and recoverably (503 message in the dialog) and never shows success; the channels page shows a connected Page, a disconnected Page with Reconnect, and TikTok "Reconnect needed"; every OAuth callback state (`auth_cancelled`, `invalid_state`, `success`, expired Page-picker session) is explained, and the backend callback turns forged state, a user cancelling and an unsupported provider into redirects, never a 500; the authorization URL the app composes for Instagram and TikTok carries our client id, the callback and a signed state, TikTok asks for login scope only, and the endpoint refuses unauthenticated and unsupported-provider calls; dialogs have a name, take focus, close on Escape and keep Tab inside; the offline banner appears and the page recovers.

What this does **not** prove: no OAuth round trip with a provider happened (navigation to the provider was blocked, the app ids were fake), no real Page, TikTok account or WhatsApp number was connected, and the payment provider was not configured. Those need a human login, provider approval or a credential, and stay open (see the readiness checklist).

During these runs the backend made one request to Paystack's API with an empty key (before the fix), which Paystack rejected with 401; no payment or customer data was involved.
