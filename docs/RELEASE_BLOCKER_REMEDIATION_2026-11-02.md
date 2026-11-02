# Release-blocker remediation (2026-11-02)

Addendum to `RELEASE_READINESS_2026-11-02.md`. Branch `feature/ai-no-canned-replies`, nothing committed, pushed, merged or deployed.
**This does not declare the release ready.** It records what was fixed and verified, and what is still open.

## Phase results

| Phase | Result |
|---|---|
| 1. Internal endpoints + payment integrity | PASS (code + unit + live boot). Deploy needs `INTERNAL_SECRET` provisioned. |
| 2. Hybrid-RAG reconciliation | PASS for code and regression tests. Real MiniLM embeddings NOT verified (no model files here). |
| 3. Campaign execution | PASS in code, unit and live-queue tests. Not yet run with a real channel/credentials. |
| 4. New workspace defaults | NOT CHANGED by design: recommendation only, needs a business decision. |
| 5. Verification | PASS for what is listed below; real payments and real embeddings remain BLOCKED. |

## Phase 1
- `/manage/settings/ai/trial-expired` and `/subscription-downgraded` now fail closed (constant-time compare, empty/missing secret never matches).
  `INTERNAL_SECRET` was set in no compose file before; added to backend and worker in `infra/docker-compose.yml` and `.staging.yml`, documented in `infra/.env.example`.
- Commerce Paystack webhook refuses before any state change: reference not issued for the order, order not payable, amount or currency differing
  (exact match). Recorded as FAILED, answered 200. Duplicate protection (ledger unique key) unchanged.
- Related paths: credit-pack payments exact match; gateway subscription invoices "at least" match.
- Shared rule: `common/payments/payment-match.util.ts`.

## Phase 2
Hybrid retrieval applied from the hybrid branch diff by hunk (no merge/reset/cherry-pick), with Digital Self kept. Regression suite:
`ai-core/pipeline/hybrid-rag-and-digital-self.integration.spec.ts`. pgvector store suite passed 13/13 on a real pgvector Postgres.

## Phase 3
`CampaignsService.launch` schedules a delayed job with a stable id; `ScheduledCampaignProcessor` consumes it, claims the campaign atomically
(only if still SCHEDULED), reverts on enqueue failure, marks FAILED after the final attempt, and deleting a campaign removes its job.
Known pre-existing risk: a campaign whose channel credentials are missing can stay RUNNING after retries.
Do not advertise campaigns as operational until one real scheduled send has been observed on staging.

## Phase 4 (recommendation only)
Free is seeded as 1 agent / 1 channel / 0 templates / 0 campaigns; only agent and campaign limits are enforced in code.
Suggest raising Free toward the Starter allowances (2 agents, 3 templates, 3 campaigns) through the existing admin overrides
(`PATCH plans/:id`, `PATCH workspaces/:id/force-plan`) or a reviewed data change. Marketing claims ("Broadcast campaigns", team inbox) conflict with Free limits.
Presentation fix only: the web billing meter shows "Not included" for a limit of 0 instead of a full `0 / 0` bar.

## Phase 5 evidence
- Full backend suite: 230 suites passed, 4 skipped; 3544 tests passed, 81 skipped.
- `tsc --noEmit` clean for backend, frontend, mobile, worker.
- Live boot of the built backend against disposable Postgres (all migrations applied) and Redis, test keys only:
  - internal endpoints: no header / empty / wrong secret = 401; correct secret = reaches the service; server with the secret UNSET = 401 for every header.
  - signed Commerce events on a GHS 100.00 order: bad signature 400; GHS 99.00, GHS 150.00, USD 100.00 and wrong reference all answered 200 with order still PENDING_PAYMENT and 0 ledger entries;
    correct payment = PAID with 2 entries; duplicate = no new entries.
  - a due job on the `scheduled-campaign` queue was consumed by the backend process (completed, safe no-op for a campaign that is not scheduled).
- Boot needs `STRIPE_SECRET_KEY` set even in development (Stripe gateway constructor throws otherwise): existing behaviour, not changed.
- The two internal endpoints return 500 (not 400) when the body has no `tenantId`; harmless since the secret is checked first, left unchanged.

## Still open / decisions needed
1. Provision `INTERNAL_SECRET` (backend and worker) before any deploy.
2. Plan defaults for Free, and whether to keep campaign/template marketing claims.
3. Refund trigger (D3): nothing triggers a refund today.
4. whatsapp-web internal key still fails open (S5).
5. Real MiniLM embedding verification and real Paystack test-mode payment on staging.
6. A real scheduled campaign send on staging.
7. Instagram Meta-side subscription (your action); schema drift and stale docs listed in the audit.

---

# Round 2 (2026-11-02): remaining technical blockers

Nothing was committed, pushed, merged or deployed. Staging, production, provider configuration and customer financial records were not touched.
"Mocks" = unit tests with fakes. "Local" = disposable local Postgres (pgvector image) and Redis, built apps, test keys only.
No real provider credentials were used, and no request reached Meta, Paystack or Stripe.

## Status of every item

| # | Item | Status | Verified with |
|---|---|---|---|
| 1 | S5: whatsapp-web internal key failed open | PASS | mocks (backend guard 9, whatsapp-web 6) + local |
| 2 | Realtime `/internal/emit` had no authentication | PASS | mocks (5) + local |
| 3 | Realtime JWT fell back to the public default `changeme` | PASS | typecheck, local boot |
| 4 | Realtime conversation rooms not scoped by workspace (cross-tenant event leak) | PASS | mocks (5); no multi-client socket test run |
| 5 | WhatsApp and Resend inbound webhooks accepted unsigned requests in production | PASS | mocks + local |
| 6 | Resend webhook had no replay window | PASS | mocks |
| 7 | Public media route path traversal (local storage driver) | PASS | mocks (14) + local (404) |
| 8 | Link preview SSRF | PASS | mocks (10, no network) |
| 9 | User-supplied media URL SSRF on send | PASS | mocks (8); no real-network download test |
| 10 | Campaign left RUNNING after missing credentials / exhausted retries | PASS | mocks (50) + local worker |
| 11 | Pause did not stop a batch already in flight; recipients not scoped to the campaign | PASS | mocks |
| 12 | Campaign final state inaccurate (all-failed shown COMPLETED) | PASS | mocks + local |
| 13 | Reconciliation ignored currency | PASS | typecheck only (no worker test runner) |
| 14 | Commerce refunds: no route or job can start one | BLOCKED (decision + provider work) | read-only trace |
| 15 | Backend would not boot without `STRIPE_SECRET_KEY` | PASS | mocks + local boot in production mode |
| 16 | Production startup validation | PASS | mocks (10) + local (refused, then started) |
| 17 | Internal endpoints returned 500 for a missing `tenantId` | PASS | mocks + local (400) |
| 18 | Graceful shutdown, readiness | PASS | local (SIGTERM, all three exit in 2 s) |
| 19 | SLA breach alerts never reached the browser (wrong request shape) | PASS | typecheck, not exercised end to end |
| 20 | Schema drift | PASS for runtime; two items left as is (below) | local diff on a fresh migrated DB |
| 21 | Upgrade path from a production-like database | BLOCKED | needs a copy of production data |
| 22 | Terms/marketing channel claims | PASS for Telegram/TikTok; billing text needs your decision | read |
| 23 | whatsapp-web service boot and Baileys flows | NOT STARTED | only the auth middleware is tested |
| 24 | Tenant-isolation audit of all 439 routes | PARTIAL | heuristic scan, no hits; not a proof |

## Details

### 1. S5 and other internal-secret fail-open (PASS)
- **Defect:** `InternalApiKeyGuard` let every caller in when `WHATSAPP_WEB_INTERNAL_API_KEY` was unset outside production; `apps/whatsapp-web` did the same in every environment (`next()` after a warning). Both compared with `!==`.
- **Root cause:** a deliberate "ship before the secret exists" design that treated network location as authentication.
- **Fix:** both fail closed in every environment (backend 401, whatsapp-web 503 when unconfigured, 401 for missing/empty/wrong), constant-time compare, the key is never logged. whatsapp-web also refuses to send events to the backend without a key, and the worker's direct send path refuses with a clear error.
- **Callers traced:** backend to whatsapp-web (`whatsapp-web.service.ts`), worker to whatsapp-web (`automation.processor.ts`), whatsapp-web to backend (`session-manager.ts`). All send `x-internal-api-key` from `WHATSAPP_WEB_INTERNAL_API_KEY`, which every compose file already passes to all three.
- **Files:** `backend/src/common/guards/internal-api-key.guard.ts` (+spec), `whatsapp-web/src/internal-auth.ts` (+test), `whatsapp-web/src/index.ts`, `session-manager.ts`, `worker/src/processors/automation.processor.ts`.
- **Evidence (local, sanitized):** events endpoint with no header 401, wrong key 401, correct key 200.

### 2-4. Realtime (PASS)
- **Defects:** `POST /internal/emit` had no authentication and publishes to every connected user of any workspace; JWT secret defaulted to the literal `changeme`; a socket could join any conversation room by id, and rooms were global, so a user of workspace A who knew a conversation id of workspace B received B's messages.
- **Fix:** `/internal/emit` requires `x-internal-secret` (`INTERNAL_SECRET`), fails closed with 503 when unset; JWT secret has no default and the service refuses to start without it; conversation rooms are named `tenant:<id>:conversation:<id>` using the tenant from the verified token, events without a `tenantId` are dropped, and room/typing inputs are validated. Callers (backend `RealtimeService`, worker snooze and SLA processors) now send the secret. Compose files pass `INTERNAL_SECRET` to realtime.
- **Files:** `realtime/src/{index,gateway,internal-auth,rooms}.ts`, `realtime.test.ts`, `backend/src/realtime/realtime.service.ts`, `worker/src/processors/{snooze,sla-monitor}.processor.ts`, `infra/docker-compose*.yml`, `infra/.env.staging.example`.
- **Evidence (local):** emit with no header 401, wrong 401, correct 200, malformed body 400.
- **Not tested:** a real two-tenant socket.io session. The room logic is unit-tested only.

### 5-6. Inbound webhooks (PASS) - deployment-impacting
- **Defect:** with `WHATSAPP_APP_SECRET` or `RESEND_WEBHOOK_SECRET` unset, production accepted unsigned requests. Anyone who knew a workspace id could forge customer WhatsApp messages into that workspace. Resend had no timestamp window, so a captured request could be replayed.
- **Fix:** production refuses (400) when the secret is missing; non-production accepts with a warning; Resend enforces a 5-minute timestamp window. Existing tests that encoded "accept unsigned" were rewritten, not deleted. Messenger already failed closed in production. Stripe and Paystack already refuse without a secret.
- **Evidence (local, production mode):** WhatsApp webhook unsigned 400, forged 400, correctly signed 200; email with no secret 400.
- **Consequence:** WhatsApp messages stop arriving the moment this is deployed to a server without `WHATSAPP_APP_SECRET`. The backend now also refuses to start in production without it, so this fails at deploy time, not silently.

### 7. Media path traversal (PASS)
- **Defect:** `GET /media/serve/:fileKey` is public and, on the local storage driver, joined the key into a filesystem path (`..~..~etc~passwd` becomes `../../etc/passwd`).
- **Fix:** keys must be plain path segments (no dotfiles, `..`, backslash, control characters); every local-driver path is resolved and must stay inside the upload directory; new upload extensions are reduced to letters and digits. Older keys with spaces or accents still serve.
- **Not confirmed:** which driver production uses. If it uses S3/MinIO the traversal was not exploitable there, but the key-shape check still applies.

### 8-9. SSRF (PASS)
- **Defects:** the link-preview endpoint (any logged-in user) fetched any URL with 3 redirects and returned the page title/description; sending a message with a `mediaUrl` that was not one of our own links made the server download it and forward the bytes to WhatsApp.
- **Fix:** both use the guarded downloader already used by the knowledge base (public addresses only, DNS pinned at connect time, redirects validated per hop, no proxy, default ports only). New `fetchPublicFile` for binary files.
- **Residual:** other fetches use Meta-provided URLs (signature-verified webhooks) or fixed hosts.

### 10-12. Campaigns (PASS, not delivered to a real channel)
- **Defect:** missing credentials threw; after the last retry nothing finalised the batch, so recipients stayed PENDING and the campaign RUNNING forever. Recipients were looked up by id only. A pause did not stop the batch being sent. An all-failed campaign became COMPLETED.
- **Fix:** missing credentials are treated as permanent (batch closed as FAILED with a reason, no retry loop). The last failed attempt also closes the batch. Recipients are scoped to the campaign. The worker re-checks the campaign is RUNNING before every recipient. Settlement: nothing sent and something failed = FAILED, otherwise COMPLETED (a non-zero `failedCount` means partially completed); only a RUNNING campaign is settled.
- **Evidence (local, real worker + Redis + Postgres):** RUNNING campaign with no credentials, 3 recipients: campaign FAILED, 3 recipients FAILED, failedCount 3, job completed (no retries). Paused campaign untouched (3 PENDING). A job whose tenant does not match its campaign touched nothing. Worker log: `credentials are missing or invalid ... failing the batch`.
- **Not done:** the transient-failure path (Meta 5xx until retries run out) was tested with mocks only; a real send needs a real Meta test number. Cancelling an already RUNNING campaign is still not offered (pause is). A crash between the Meta call and the database update can still duplicate one message on retry.

### 14. Refunds (BLOCKED)
- **Finding:** `CommerceLedgerService.recordRefund` exists and is correct, but nothing calls it: no controller, job, webhook or admin action. The Paystack gateway only implements initialize, verify and disable-subscription; there is no refund call and no handler for refund events.
- **Why not built:** Paystack does offer a refund API (asynchronous: pending, processed, failed), but a safe workflow needs (a) a persisted refund record to track pending/successful/failed and block duplicates, which means a new table and migration; (b) a decision on who may refund (role), whether the platform or the merchant bears it, and how a merchant's take-rate clawback is settled; (c) a real Paystack test-mode account to verify the callbacks. None can be simulated honestly.
- **Safe today:** because nothing calls `recordRefund`, no refund can be recorded by accident.
- **Decisions needed:** the three points above, then roughly: new `commerce_refunds` table, `POST /commerce/orders/:id/refund` (admin only, tenant-scoped, idempotency key), a provider call, a `refund.processed` webhook that is the only thing allowed to call `recordRefund`.

### 15-18. Boot and reliability (PASS)
- **Defects:** the Stripe SDK was constructed in the provider constructor and throws on an empty key, so the backend could not start without card payments configured; a startup failure was an unhandled rejection; no shutdown hooks (`onModuleDestroy` never ran on SIGTERM); the internal endpoints returned 500 for a missing `tenantId`.
- **Fix:** Stripe is created on first use and a missing key gives a 503 only for card-payment calls (webhook verification fails closed). Production start requires `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET` and logs (names only) which optional integrations are missing. Startup errors print one line and exit 1. `/api/v1/health/ready` checks the database (503 on failure). Shutdown hooks enabled; realtime now closes cleanly. `tenantId` is validated after the secret check (401 first, then 400).
- **Evidence (local):** production start without the secrets: `Refusing to start in production with insecure or missing secret(s): INTERNAL_SECRET, WHATSAPP_WEB_INTERNAL_API_KEY, WHATSAPP_APP_SECRET` and exit code 1. With them and no Stripe key: started, health 200, ready 200. SIGTERM: backend, worker and realtime exited in 2 s, worker logged `Graceful shutdown`.
- **Not tested:** Redis outage behaviour; readiness does not check Redis.

### 19. SLA breach alerts (PASS, unverified end to end)
The worker posted `{tenantId, event, data}` to a route that requires `{event, payload}`, so every call returned 400 and the alert was lost after the conversation was already marked breached. The body now matches.

### 20. Schema drift (analysed, no migration written)
Method: migrate a fresh Postgres with `prisma migrate deploy`, then `prisma migrate diff` the database against `schema.prisma`.
- **Nothing the code needs is missing:** the diff contains no `CREATE TABLE` or `ADD COLUMN`. The earlier emergency migration (`20260708110000`) already closed that.
- **The database has more than the schema** (columns `canned_responses.category`, `conversation_events.metadata`, `feature_flags.rollout_type`, `platform_settings.updatedBy`; six indexes; two foreign keys). These are kept: dropping them would destroy data or integrity, and the earlier migration notes say they need data inspection first.
- **Intentional difference:** `messages (tenant_id, whatsapp_message_id)` is a partial unique index (where not null) that Prisma cannot express, so every diff reports it as missing. It exists and protects against duplicate inbound messages. Do not run `prisma migrate dev` against a shared database; it would try to rewrite it.
- **Cosmetic:** `updated_at` and a few other defaults, one timestamp precision, and the delete rule on three foreign keys (RESTRICT vs SET NULL). The app already deletes call logs before a contact.
- **Production mismatch:** the audit recorded 98 applied migrations in production and this tree has 94 migration folders, so production already has migrations that are not in this branch. `migrate deploy` tolerates that, but the source of those 4 is unknown. Staging showed 95. Find them before deploying.
- **Upgrade path: BLOCKED.** This branch adds no migration over `d5f93b9`, so there is nothing new to upgrade. Rehearsing against production data needs a copy that I do not have and must not touch.

### 22. Product and documentation consistency
- **Fixed:** the Terms listed Telegram as a supported channel and the Channels page header promised "one unified inbox for ... TikTok, and Telegram". Neither sends or receives messages (the marketing data file already says so). Both now say what is true: TikTok and Telegram can be connected and verified; their messages do not reach the inbox.
- **Left for you (legal and business):** the Terms "Billing" section still says "Your subscription renews automatically at the start of each billing period" and promises no refunds for partial months, but monthly subscriptions are no longer sold (credits and Commerce fees instead). I did not rewrite contract text. Proposed replacement, for counsel to approve: "VerzChat is not sold as a monthly subscription. AI usage draws on prepaid credits you buy in the app, and payments taken through VerzChat Commerce carry the platform fee shown in your workspace settings. Any subscription you already hold keeps its existing terms until it ends." It must state what happens to unused credits, which I could not find a rule for.
- **Free plan (unchanged, awaiting your approval):** 1 agent, 1 channel, 0 templates, 0 campaigns (`prisma/seed.ts`; agents and campaigns are enforced in code). The sign-in page says "Broadcast campaigns to thousands at once" and the WhatsApp card says "Broadcast campaigns to thousands", which a Free workspace cannot do. Recommendation: raise Free toward the Starter allowances (2 agents, 3 templates, 3 campaigns) through the existing admin override, or soften the copy. Campaigns should not be advertised as available until one real send has been seen on staging.
- **Stale docs:** not swept; `docs/VERZCHAT_AI_IMPLEMENTATION_PROGRESS.md` still mentions subscriptions. Environment documentation updated: `infra/.env.example` and `.env.staging.example` now list `INTERNAL_SECRET`.

### 24. Authorization and tenant isolation
- Public (no JWT) controllers: webhooks (signature-verified), client errors, demo booking (rate-limited), public checkout, public pricing/version, media serve. Everything else is behind `JwtAuthGuard`.
- A scan for id-only Prisma reads/writes with no tenant condition in the same method found only internal helpers (ledger, credit reservations, AI executions) and platform-admin prompt management. Low severity, noted: `PromptsService.activateVersion` does not check that the version belongs to the template (platform admins only).
- Not audited: mass assignment on each DTO, platform-admin role matrix, mobile/frontend authorization, background jobs beyond campaigns. The scan is a heuristic, not proof.

## Verification summary
- Backend: 234 suites passed (4 skipped), 3628 tests passed (81 skipped). `tsc --noEmit` clean for backend, frontend, mobile, worker, realtime, whatsapp-web. whatsapp-web 32 and realtime 5 tests pass.
- Local services (Postgres + Redis, test keys): production-mode boot, health/ready, internal endpoints, signed webhook checks, media traversal, campaign lifecycle on the real worker, SIGTERM for three services.
- Log review of the backend, worker and realtime: no unhandled exception or rejection, no 5xx, no repeated retry, none of the four test secrets appeared in any log. The only error line was the intended `RESEND_WEBHOOK_SECRET ... REFUSED`.
- Not run: frontend and mobile tests (no runner exists beyond source-scanning specs in the backend suite), real Meta/Paystack/Stripe calls, hybrid-RAG with real embeddings, whatsapp-web with a real session.

## Remaining production blockers
1. Secrets must be provisioned in every production service before deploy (table below); the backend now refuses to start without them.
2. Refunds cannot be initiated (item 14). If refunds are promised to merchants, this blocks. If refunds are handled manually outside the app, it does not.
3. The 4 production migrations that are not in this tree (item 20).
4. No real-channel campaign send, no real Paystack test-mode payment through the new checks, and no real-embedding hybrid-RAG run have been observed.
5. Terms billing text and Free plan/marketing copy (your decisions).
6. Instagram: Meta-side webhook subscription (your action).

## Environment variables by service
| Variable | backend | worker | realtime | whatsapp-web | Notes |
|---|---|---|---|---|---|
| `INTERNAL_SECRET` | required | required | required | not used | worker/backend call realtime and the settings endpoints with it |
| `WHATSAPP_WEB_INTERNAL_API_KEY` | required | required | not used | required | same value in all three |
| `WHATSAPP_APP_SECRET` | required | not used | not used | not used | Meta app secret; WhatsApp webhooks refused without it |
| `JWT_SECRET` | required | not used | required | not used | realtime now refuses to start without it |
| `JWT_REFRESH_SECRET` | required | not used | not used | not used | |
| `FACEBOOK_APP_SECRET` | needed for Messenger/Instagram | | | | refused without it |
| `RESEND_WEBHOOK_SECRET` | needed for inbound email | | | | refused in production without it; also present in `docker-compose.yml` only, not staging |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | optional | | | | card payments only |
| `PAYSTACK_SECRET_KEY` | needed for Commerce | needed for reconciliation | | | |

## Manual Meta/provider configuration (not done by me)
- Meta app: webhook callback URL and verify token for WhatsApp, Messenger and Instagram; subscribe the Instagram `messages` field; confirm the app secret in `WHATSAPP_APP_SECRET` is the same app that signs the webhooks.
- Resend: set the inbound webhook signing secret and copy it to `RESEND_WEBHOOK_SECRET` (add it to the staging compose if staging receives email).
- Paystack: confirm the webhook URL and that the account is in the expected mode; no refund webhook is configured or handled.
- Stripe: only if card payments are wanted.

## Deployment checklist
1. Generate `INTERNAL_SECRET` and `WHATSAPP_WEB_INTERNAL_API_KEY` (random, 32+ bytes); confirm `WHATSAPP_APP_SECRET` is present. Set them on backend, worker, realtime and whatsapp-web as in the table. Do not log them.
2. Check the migration history on the target database against `prisma/migrations` (item 20).
3. Deploy in this order: whatsapp-web and realtime (they refuse requests until configured), backend, worker. Backend will not start if a required secret is missing.
4. Smoke checks: `/api/v1/health/ready` 200; a signed WhatsApp test message arrives; an unsigned one gets 400; the realtime emit without the header gets 401; a scheduled campaign test on a test number reaches a terminal state.
5. Watch for the first hour: `[config]` lines, `RESEND_WEBHOOK_SECRET ... REFUSED`, `WHATSAPP_APP_SECRET ... REFUSED`, 401s from worker or backend to realtime.

## Rollback
- Everything in this round is code and configuration; there is no migration. Redeploy the previous images.
- If inbound WhatsApp stops after deploy, the cause is almost certainly `WHATSAPP_APP_SECRET` missing or not matching the app; fix the variable rather than rolling back.
- If realtime events stop, check `INTERNAL_SECRET` on backend, worker and realtime match.
- Campaigns already marked FAILED by the new rules can be relaunched from the campaign list.

## Recommendation: NO-GO
The code-level blockers I could address are fixed and verified locally, but this is not production-ready: required secrets are not yet provisioned anywhere I can see, the deployment will change behaviour (WhatsApp and email webhooks now refuse unsigned requests, services refuse to start without secrets), refunds cannot be initiated, production has migrations this branch does not contain, and nothing has been tried against a real Meta number, a real Paystack test payment, or real embeddings. Move to GO for a staging deployment once items 1 and 3 of the blockers are cleared, then re-evaluate production after a staging run of the checklist above.

---

# Round 3 (2026-11-02): final assurance phase

No commit, push, merge or deployment; production and staging were not contacted. Evidence classes used below:
**unit** = Jest/node:test with fakes; **integration** = real code against a real database or real sockets, local; **disposable-local** = built apps on throwaway Postgres/Redis; **real-provider** = a real Meta/Paystack/Stripe call. **No item in this round has real-provider evidence.**
New supporting documents: `COMMERCE_REFUND_DESIGN.md`, `REAL_INTEGRATION_TEST_PLAN.md`, `BUSINESS_LEGAL_DECISIONS.md`.

## Correction to Round 2 (migration count)
Round 2 said production "has migrations this tree does not have (98 vs 94)" and Round 3's brief repeated "four missing". Both were a misreading of row counts.
`_prisma_migrations` on production has 100 rows: 98 finished, 2 rolled back, but only **95 distinct names**. The extra rows are repeats (a migration recorded 2-3 times, and two rolled-back first attempts). Exactly **one** name is absent from this tree.

## Status table

| # | Item | Status | Evidence class |
|---|---|---|---|
| M1 | Identify the "missing" production migrations | PASS | read-only analysis of the captured production/staging tables + git |
| M2 | Fresh install from the current tree | PASS | disposable-local |
| M3 | Ordering and checksums | PASS with a recorded caveat (12 production checksums differ from repo files) | analysis + disposable-local |
| M4 | Upgrade from a representative older schema, data preserved | PASS | disposable-local (50 to 95 migrations, seeded rows, hashes unchanged) |
| M5 | Prisma schema consistency after migration | PASS | disposable-local (`migrate diff`) |
| M6 | Upgrade of a production-like database with real data | BLOCKED | needs sanitized artifact (below) |
| S-A | DTO / mass assignment | PASS for the paths reviewed; NOT a complete review | unit + integration |
| S-B | Platform-admin authorization matrix | PASS | unit (metadata matrix + guard) |
| S-C | Tenant isolation, two workspaces, two identities, sockets | PASS for the services and socket gateway tested; not every route | integration |
| S-D | SSRF and file access | PASS | unit + disposable-local (no real network) |
| R | Refund workflow | BLOCKED (design delivered, owner decisions needed) | none |
| T | Real-provider integration tests | BLOCKED (plan delivered) | none |
| L | Business / legal decisions | Report delivered; decisions pending | n/a |

## M1-M5 Migrations (P0)

**Finding.** The one name in production and staging that is not in this tree is `20260708120000_verz_ai_grounded_retrieval`. It exists only in commit `5ba3e99` (2026-07-08, "grounded retrieval, verification gate, and escalation logic") on branch `feature/verz-ai-grounded-reply-engine`. That commit is **not** an ancestor of `main`, `staging`, `dev`, this branch or its base `d5f93b9`, yet its migration was applied to both databases, so it was deployed from that branch at some point and later deployments came from branches without the folder.
Its production and staging checksum, `d1061534a1a7481e3da1fdf7425ce8d43af22b2a3e943b4acf44deb4f2002d79`, is byte-identical to `git show 5ba3e99:...migration.sql`.
What it does: creates `knowledge_base_chunks` (with a generated tsvector column and GIN index), `ai_knowledge_gaps`, adds 7 columns to `ai_interaction_logs` and 5 to `tenant_settings`, all `IF NOT EXISTS`/additive; no data transformation, no drop. The current `schema.prisma` and code use none of it.

**Comparison method.** Names and full checksums of both databases were taken from the earlier read-only capture (`server-schema-output.txt`); the schema-only dumps in the same capture were restored into disposable databases; `prisma migrate diff` compared them to databases built from this tree.

| Comparison | Result |
|---|---|
| Staging names/checksums vs this tree + the one folder | identical (0 differences) |
| Staging schema vs fresh install of tree + the folder | **0 statements** |
| Production names vs tree | 95 distinct names, 1 not in tree, 94 match by name |
| Production checksums vs tree files | **12 differ** (listed below) |
| Production schema vs fresh install | 33 statements, none needed by the code |
| Production schema vs `schema.prisma` | only the partial unique index on `messages (tenant_id, whatsapp_message_id)` (which exists, Prisma cannot express it) and 3 foreign-key delete rules; no missing table or column |

The 12 differing checksums (production recorded vs repo): `init`, `add_contacts_message_type` (recorded as all zeros), `add_performance_indexes`, `conversation_lifecycle` (`manual_migration`), `calls_enterprise`, `platform_admin`, `call_status_lifecycle`, `call_direction_status_refactor`, `remove_tenant_slug` (`manual`), `campaign_click_tracking`, `update_starter_plan_price`, `add_free_plan`. Interpretation (not proven): they were edited after being applied, or applied by hand. Staging was built from the current files and shows no difference.
Consequence on production: it lacks `canned_responses.category`, `conversation_events.metadata`, `feature_flags.rollout_type`, `platform_settings."updatedBy"`, some updated_at defaults, three indexes and constraint-name spellings that the repo migrations create. No code path uses them (`schema.prisma` does not define them), so this is divergence, not breakage.

**Fix.** Added `apps/backend/prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql`, copied byte for byte from `5ba3e99` (checksum verified above). No applied migration was edited, none renamed, none created from guesses. Effect: a fresh database built from this tree now equals staging exactly; on production and staging `migrate deploy` sees it as already applied. **Owner decision:** this puts a migration from an unmerged feature branch into this branch's history. Alternative: leave it out and accept that fresh installs differ from staging by these two unused tables.

**Tests (disposable-local, PostgreSQL 16 + pgvector image):**
1. Fresh install of the tree: 94 migrations applied cleanly; with the folder: 95, `migrate status` "up to date".
2. A database with the 95 migrations, then production's quirks injected (3 checksums set to `manual`, 2 duplicate finished rows, 1 rolled-back row, 98 rows / 95 distinct): `migrate deploy` "No pending migrations", `migrate status` "up to date", exit 0. `migrate deploy` therefore tolerates an applied migration it does not have locally, edited checksums, duplicates and rolled-back attempts. (`migrate dev` would not; never run it against a shared database.)
3. Upgrade rehearsal: 50 migrations applied, rows inserted into tenants/users/contacts/conversations/messages, the remaining 44 applied: row-content hashes before and after identical; the resulting schema equals a fresh install (pg_dump diff: only the random restrict tokens); `migrate diff` against `schema.prisma` shows no missing table or column.

**M6 BLOCKED, exactly what is needed to close it.** A sanitized, restorable copy of production produced by the owner (not by me): (a) `pg_dump --schema-only` taken on the same day as the planned deploy (the capture I used is dated before the 2026-11 changes); (b) row counts per table; (c) for the largest tables (`messages`, `contacts`, `conversations`, `knowledge_base_articles`) a data-masked dump (phones, names, message bodies, tokens replaced) or the same tables with only structure and realistic cardinalities; (d) the current `_prisma_migrations` with full checksums. With that, the rehearsal is: restore, run `prisma migrate status`, `prisma migrate deploy`, `migrate diff`, then the application smoke suite. Because this branch adds no executable migration (the only new folder is already applied everywhere), the risk of the deploy touching the schema is already low; M6 mainly protects against future migrations.

**Remaining risks:** the 12 divergent production checksums mean a future migration that touches those objects could behave differently on production; reconcile production by a reviewed forward migration only after M6. Do not "fix" it by editing applied files or resetting.

## S-A Mass assignment (DTO review)

Method: listed every controller parameter typed as an inline object, `Record`, `any` or `unknown` (the global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted` only validates class DTOs, so these bodies bypass it), and every service that passes a body into a Prisma `data`.

| # | Defect | Severity | Fix | Evidence |
|---|---|---|---|---|
| A1 | `PATCH /manage/settings/off-hours`, `/opt-in-out`, `/widget` (body `any`) and `/welcome`, `/ai` (inline type) required only a login, no role, and spread the body into `tenantSettings` create/update. Any user, even an AGENT or VIEWER, could set **`takeRatePct` (the platform fee), `paymentVerificationRequired`, `maxAgents`, `commerceEnabled`, `aiTrialApprovedAt` (bypassing the admin approval route), Airtable credentials, even `tenantId`**. | Critical | Five DTO classes list only each screen's fields (unknown fields rejected); the service copies only the fields each route owns, even if called with more; routes restricted to ADMIN/SUPER_ADMIN like the neighbouring `reply-deadline` and `ai/approve` routes. | unit: 128 tests incl. 13 protected fields x 5 routes rejected, service drops smuggled fields, role metadata |
| A2 | `PATCH /tenant/onboarding` (body `Record<string, unknown>` cast to `any`) had no role, so any member could change the workspace's **WhatsApp credentials**, and could set `plan` (the plan label). | High | `UpdateOnboardingDto` (no `plan`; the screen's `businessName`/`businessEmail` accepted and ignored), `plan` write removed, ADMIN only. | unit: protected fields rejected, screen payload accepted, role metadata |
| A3 | Cross-tenant `toggleBlock` returned a 500 (Prisma `findFirstOrThrow`) instead of 404. Isolation held. | Low | 404 `NotFoundException`. | integration (real DB) |
| A4 | Platform-admin setup secret compared with `!==`. | Low | constant-time compare. | unit |

Checked and found sound: `editMember` and `createInvitation` (rank checks, no self-promotion, no role above the actor's), `UpdateCampaignDto`, `UpdateContactDto`, `UpdateTemplateDto`, `UpdateAutomationRuleDto`, `UpdateTenantSettingsDto` (class DTOs without protected fields), platform-admin `UpdateWorkspaceDto`/`UpdatePlanDto`.
**Not reviewed (honest limit):** the remaining inline-typed bodies (knowledge-base, teams, tags, segments filters, api-keys, ai-logs ratings, workspace password reset, auth flows) were read only for obvious spreads; segment `filters` and automation `conditions/actions` are unvalidated JSON; every `as never` cast was not audited. This is not a complete DTO audit. A follow-up should replace the remaining inline types with DTO classes.
**Behaviour change:** AGENT and VIEWER users can no longer change these workspace settings. If a product decision allowed agents to edit, for example, the welcome message, that needs an explicit role grant.

## S-B Platform-admin authorization (unit)
Roles in the code: `SUPER_ADMIN`, `SUPPORT`, `VIEWER` (stored on `PlatformAdmin`). Tenant roles (`SUPER_ADMIN`, `ADMIN`, `AGENT`, `VIEWER` plus workspace roles OWNER/ADMIN/MANAGER/AGENT/ANALYST/VIEWER) are a separate system.
A test reads the controller's own metadata, so a new route cannot be added without a decision:
- All 63 routes except the 4 sign-in/setup/password-reset routes sit behind `PlatformAdminGuard`.
- No mutating route is open to VIEWER.
- SUPPORT can do exactly 5 operational actions (error status, edit workspace name/billing email, suspend, activate, toggle a user). Everything else that mutates is SUPER_ADMIN only, including: commerce fee, credit grants, force-plan, per-workspace commerce switch, admin invites and role changes, plans, AI pricing and credit packages, feature flags, webhook reprocess.
- The guard already (existing tests, re-run): rejects a tenant user's valid JWT (403), an admin switched off after the token was issued, a demoted admin (role read from the database each request), a token for an admin that does not exist in this database, and a database read failure.
- Tenant user tokens are re-validated on every request (user active, membership not suspended, workspace active).
Not covered: API keys (`wap_...`, public API) authorization beyond the tenant isolation test; mobile/web UI visibility is irrelevant to this check by design.

## S-C Tenant isolation (integration)
- **Database (real Postgres, all migrations, two workspaces, two users):** acting as workspace A against workspace B ids, contacts (read/update/block/delete/list), automation rules, tags, teams (including adding a B user to an A team and an A user to a B team), segments and API keys (revoke/delete/list/validate) all fail with 404 or return nothing, and **B's rows were re-read from the database and found unchanged** after every attempt. A's token pointed at B's workspace is rejected; a suspended membership, a deactivated user and a suspended workspace are each rejected. Gated by `TENANT_ISOLATION_TEST_DATABASE_URL` (refuses a database whose name lacks test/scratch/tmp); 10 tests.
- **Sockets (real socket.io server and clients, real JWT verification):** two workspaces using the **same conversation id** never receive each other's events; a user who joins another workspace's conversation id receives nothing; workspace-wide events and typing indicators stay inside their workspace; personal events reach only that user; an event with no workspace is dropped; no-token and forged-token connections are refused. 5 tests.
- **Mutation check:** restoring the old global room name made 4 of those tests fail, so the tests detect the original leak (workspace B receiving workspace A's messages by joining A's conversation id).
- **Background jobs:** the campaign worker refuses a job whose tenant does not match the campaign (Round 2 disposable-local test); no other queue's tenant scoping was tested.
- **Not covered:** the other ~60 tenant-scoped controllers (messages, conversations, campaigns create/launch, billing, commerce orders, knowledge base) were not run against two real workspaces; the heuristic scan of id-only Prisma access in Round 2 found only internal helpers.

## S-D SSRF and file access
- Link preview: unit, internal/private/metadata/`file:`/`ftp:` URLs return an empty preview with no request.
- `mediaUrl` on send: unit, `fetchPublicFile` refuses loopback, localhost, metadata, internal hostnames, non-http schemes, a public host that resolves inward (DNS pointing inward), and a public URL that redirects to an internal address (after exactly one request).
- Knowledge-base URL ingestion: existing tests re-read: DNS answers with any internal address, redirects to internal/IPv6/decimal-IP/backslash forms, redirect chains, DNS rebinding at connect time, proxy variables ignored, default ports only.
- Address ranges probed with a one-off test: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, multicast, reserved, `::`, `::1`, `fe80::`, `fc00::/7`, IPv4-mapped, NAT64 and 6to4 forms were all blocked; 8.8.8.8, 1.1.1.1, 93.184.216.34, 172.15.x, 172.32.x and a public IPv6 were allowed.
- Local-storage media: unit + disposable-local: `..~..~etc~passwd` and `%2e%2e` forms return 404; the local driver resolves every path and refuses anything outside the upload directory.
- No request was made to any real internal or production service.
- Residual: Airtable and tenant webhook delivery hosts are fixed or checked by `assertSafeWebhookUrl`, but Airtable base/table names are tenant input placed in a URL path on a fixed host (path-only, low); the outbound webhook delivery worker, if it exists in another branch, is not in this tree.

## R Refund workflow: BLOCKED
Traced end to end (`COMMERCE_REFUND_DESIGN.md`). The ledger half (`recordRefund`, exact take-rate reversal using the order's recorded rate) exists and is tested; nothing calls it, there is no Paystack refund call, no refund webhook, no refund record. Payments settle to the platform's own Paystack account (no subaccount/split), so a refund is a platform cash decision. I did not implement it: it needs a new table and migration, nine owner decisions (D1 to D9: who may initiate, full/partial, who bears the clawback and provider charges, source of the money, time limit, notifications), and a Paystack test account. The design covers duplicates, never marking success before the provider confirms, provider-succeeded/local-failed recovery via a write-ahead record and reconciler, audit and notifications. No financial record was touched and no provider success was simulated.

## T Real integration tests: BLOCKED
`REAL_INTEGRATION_TEST_PLAN.md` gives reproducible steps, prerequisites and expected evidence for Paystack test mode, WhatsApp, Instagram, scheduled campaigns, hybrid RAG with real embeddings and WhatsApp-web. **None was run; none is claimed.**
Instagram, from the earlier read-only production diagnostics: the Meta app has a webhook subscription for object `page` only (callback `/api/v1/webhook/messenger`), none for `instagram`; one Instagram channel is connected with a token, yet **zero Instagram webhook events and zero stored Instagram messages exist**, and no webhook verification was logged. Inbound Instagram therefore cannot work in production until the Meta dashboard subscription (Instagram object, `messages` field), account linking, permissions/App Review and `subscribed_apps` are configured; exact verification steps are in the plan, to be run on a **test** Meta app. Staging has `INSTAGRAM_LOGIN_CONFIG_ID` empty and shares production's callback URL, so staging cannot receive Meta events either. I changed nothing at Meta.

## L Business and legal: see `BUSINESS_LEGAL_DECISIONS.md`
Free plan (1/1/0/0) vs the "Broadcast campaigns to thousands" copy, the proposed 2/3/3 allowances (not applied), credit expiry/closure/suspension, refund authority, the Terms' auto-renewing subscription text (proposed replacement for counsel, not published), and the channel claim table. Telegram and TikTok are not described as supported anywhere now except possibly the changelog wording, which is flagged.

## Files changed this round
Migrations: `prisma/migrations/20260708120000_verz_ai_grounded_retrieval/migration.sql` (verbatim from `5ba3e99`).
Security: `manage/settings/{dto/settings.dto.ts, manage-settings.controller.ts, manage-settings.service.ts, manage-settings.mass-assignment.spec.ts}`, `tenant/{dto/update-onboarding.dto.ts, tenant.controller.ts, tenant.service.ts, tenant.onboarding.mass-assignment.spec.ts}`, `contacts/contacts.service.ts`, `platform-admin/{platform-admin-auth.service.ts, platform-admin.role-matrix.spec.ts}`, `tenant-isolation.db.spec.ts`, `realtime/src/gateway.isolation.test.ts`.
Docs: `COMMERCE_REFUND_DESIGN.md`, `REAL_INTEGRATION_TEST_PLAN.md`, `BUSINESS_LEGAL_DECISIONS.md`, this file.

## Final verification (this round)
- Backend Jest with the database isolation suite enabled against a disposable Postgres: **238 suites passed, 4 skipped; 3741 tests passed, 81 skipped, 0 failed.** (Skipped = suites that need other optional databases or model files.)
- `tsc --noEmit`: backend, frontend, mobile, worker, realtime, whatsapp-web all clean.
- whatsapp-web: 32 pass. Realtime: 10 pass (5 auth/rooms + 5 socket isolation).
- Disposable-local migration runs as described above. Nothing was started against production data.

## Remaining production blockers
1. **M6:** no rehearsal on a production-like copy with real data (artifact list above).
2. **Production configuration:** the secrets table in Round 2 must be provisioned; production currently has no `INTERNAL_SECRET` that I can see and the backend will refuse to start without it.
3. **No real-provider evidence** for payments, WhatsApp, Instagram, campaigns, hybrid RAG or WhatsApp-web (section T).
4. **Instagram is not receiving anything in production** (Meta configuration).
5. **Refunds cannot be initiated** (R) and need owner decisions.
6. **Terms billing text and credit treatment** need legal review (L).
7. **Incomplete security assurance:** DTO review is partial; tenant isolation tested on 6 services (contacts, automation, tags, teams, segments, API keys), the JWT strategy and the socket gateway only; no penetration test; no dependency/CVE audit was run.
8. **12 production migration checksums diverge** from the repo and production lacks four unused columns (M3).

## Required owner decisions
Include the migration folder from `5ba3e99` in this branch (recommended: yes); Free plan allowances; credit expiry/refund/closure; refund D1 to D9; Terms rewrite; whether agents may edit workspace settings; Instagram and Meta configuration; which migration approach to reconcile production's divergence.

## Pre-release checklist
- [ ] Owner supplies the sanitized production artifacts; M6 rehearsal passes (`migrate status`, `deploy`, `diff`, smoke suite).
- [ ] Decide on the `20260708120000` folder and merge it to the branch that will be deployed.
- [ ] Provision `INTERNAL_SECRET`, `WHATSAPP_WEB_INTERNAL_API_KEY`, `WHATSAPP_APP_SECRET`, `JWT_SECRET` (realtime too), `RESEND_WEBHOOK_SECRET`, `FACEBOOK_APP_SECRET` on the services in the Round 2 table.
- [ ] Deploy first to a staging stack with a test Meta app and Paystack test keys; run `REAL_INTEGRATION_TEST_PLAN.md` sections 1, 2 and 4 and keep the evidence.
- [ ] Fix and verify the Instagram Meta subscription if Instagram is to be advertised.
- [ ] Legal sign-off on Terms billing and credit treatment.
- [ ] Decide Free plan allowances or fix the marketing copy.
- [ ] Decide refund policy; if refunds are promised, implement and test them first.
- [ ] Complete the DTO review for the remaining inline bodies and run the two-workspace suite on the remaining controllers.
- [ ] Run a dependency vulnerability scan and review its output.
- [ ] Take a database backup and record the previous image tags immediately before the deploy; rehearse the rollback (previous images; no schema change is made by this branch).
- [ ] Smoke checks after deploy: `/api/v1/health/ready`, a signed WhatsApp message in and a reply out, an unsigned webhook refused, realtime event without the secret refused, a test campaign reaching a terminal state.

## Decision: **NO-GO** for production
Reasons, in order: the production-like migration rehearsal has not been possible; there is no real-provider evidence for any integration; the remaining blockers above are open; and this round alone found and fixed a critical privilege problem (any logged-in user could change the platform fee and payment-verification settings) and a cross-workspace data leak in realtime, which means the security review is not finished simply because these were fixed. A **GO for a staging deployment** is reasonable once the secrets are provisioned. A production GO needs the checklist above completed.
