# VerzChat release-readiness review

Date: 2026-11-02. Worktree `/Users/breezyyy/verz-worktrees/no-canned-replies`, branch `feature/ai-no-canned-replies`, base `d5f93b9`.
Nothing was committed, pushed, merged or deployed. Staging and production were not touched. No secrets appear in this report.

**How to read this.** Every claim carries an evidence level. A mocked unit test is not proof of a real provider.

| Tag | Meaning |
|---|---|
| U | Unit test (mocked collaborators) |
| DB | Test against a real PostgreSQL |
| L | Live: the real built application (backend, worker, realtime, frontend) running against a disposable local PostgreSQL 16 and Redis 7, with every external provider (Meta, Paystack, Stripe, DeepSeek, SMTP) absent or simulated by locally signed requests |
| B | Real browser (Chrome headless, device emulation) against the local stack |
| T | Typecheck or production build |
| R | Real provider, real payment or real model |
| H | Historical staging or production evidence recorded in earlier sessions, not re-observed now |

Statuses: PASS (directly verified), FAIL (verified defect), BLOCKED (cannot verify: missing access), PARTIAL, NOT TESTED.

---

## 1. Executive summary

**Decision: NOT READY for production. READY WITH CONDITIONS for a staging deployment.** The conditions for each are in section 17.

What is solid, verified by running it:
- The backend boots as a real NestJS application: 439 routes mapped, no startup errors, and all 94 migrations apply cleanly to an empty database.
- The new business model works end to end on the live stack. Monthly plans are hidden and unpurchasable. VerzAI activates at zero credits. Chargeable AI is refused at zero or insufficient credits and resumes after a top-up. Commerce takes its configured percentage once, per workspace, with a platform default.
- Tenant isolation held in 9 cross-workspace probes. Read-only platform admins are refused on every prompt, rate and credit administration route tested.
- Credit metering is safe under concurrency on a real database: 12 parallel calls on a balance for 3 gave exactly 3 successes, 9 refusals and no negative balance.
- The public site carries no subscription price, plan or upgrade prompt; the SEO crawler check passes 214/214; no page overflows at 390 px.

What blocks production:
1. **Security (High):** two internal endpoints fail open, because `INTERNAL_SECRET` is configured nowhere in the deployment files (section 9, S1).
2. **Money (High):** the Commerce webhook marked a 123.45 order PAID on a signed 10.00 payment (S2).
3. **Release sequencing (High):** staging runs the hybrid-RAG build, which lives on a different branch with 7 overlapping files. This branch cannot be deployed over it without an integration step (section 14).
4. **Unverified with real services (High):** no real-model and no real-payment verification was possible here. Section 7 says exactly what is missing.
5. **Business decision (High):** a new workspace is limited to 1 agent, 0 campaigns and 0 templates, with no purchase path and no self-service way to change it (section 4).
6. **Pre-existing defect (High):** scheduled campaigns can never run, because nothing consumes their queue (D1).
7. **Instagram (external):** the cause is on the Meta side, not in this code. It needs a dashboard action that only you can take (section 2A).

Two defects found in the customer UI were fixed during this review and are listed in section 11.

---

## 2. Feature inventory

Scale: 6 apps (backend, frontend, mobile, worker, realtime, whatsapp-web), 6 packages, 65 controllers, 439 route handlers, 102 database models, 50 enums, 94 migrations, 12 worker processors plus 3 backend queue processors, 15 queues, 78 web pages, 48 mobile screens, 212 backend spec files.

Branch scope: this branch is 197 commits ahead of `main` (`main` last merged 2026-10-20). Those commits are the staging line (releases 2.4.0 to 2.8.1) and the base `d5f93b9`. On top sit 67 modified, 4 deleted and 21 new uncommitted paths (71 files, +1074 / -1535 lines), listed in section 12.

### A. Messaging and channels
| Feature | Where | Dependencies | Status | Evidence | Facing |
|---|---|---|---|---|---|
| WhatsApp Cloud API (inbound, outbound, statuses, templates, calls) | `whatsapp/`, `whatsapp-numbers/`, `calls/` | Meta Graph API, `WHATSAPP_APP_SECRET` | PARTIAL | U; webhook signature fails closed in production; real Meta BLOCKED | Customer |
| WhatsApp by QR code | `apps/whatsapp-web`, `whatsapp-web/` | Chromium session, internal API key | PARTIAL | U; service not run against a real phone (BLOCKED). The internal key fails open if unset (S5) | Customer |
| Media, documents, voice notes | `media/`, `common/media/audio.util.ts` | ffmpeg, MinIO or local storage | PARTIAL | U with real ffmpeg conversions (ran, not skipped); real delivery BLOCKED | Customer |
| Messenger and Instagram messaging | `facebook-messenger/`, `channels/` | Meta webhooks, Graph API | **PASS (ingest) / FAIL in production (external)** | L: signed Instagram webhook stored, deduplicated, shown in the inbox. See 2A | Customer |
| Realtime updates | `apps/realtime` | Redis, JWT | PASS | L: boots, refuses missing and forged tokens, accepts a valid session | Customer |
| Shared inbox, ownership, takeover | `conversations/`, `messages/` | all above | PARTIAL | U (ownership rechecks); B (inbox lists the Instagram thread) | Customer |
| Chatbot flows, automations, canned replies, templates | `chatbot-flows/`, `automation/`, `canned-responses/`, `templates/` | worker queues | PARTIAL | U; pages render in B. Scheduled campaigns FAIL (D1) | Customer |
| Campaigns | `campaigns/`, worker `campaign-send` | WhatsApp templates | PARTIAL | U; **scheduled launch has no consumer (D1)**; blocked for new workspaces by plan limit | Customer |

### 2A. Instagram: investigation and root cause
The reported symptom: the channel shows connected, but sent and received Instagram messages do not appear in VerzChat.

- **Code path (L).** After registering an Instagram channel locally and sending Meta-signed webhooks: a forged signature returns 400; a correctly signed event for the registered account returns 200, stores exactly one `INBOUND` message, records a `PROCESSED` webhook event, deduplicates a retry, and the conversation appears in the inbox UI (B) as `INSTAGRAM`. The backend ingestion, persistence and display path works.
- **What does not work (L and H).** An event whose account id matches no active channel also returns 200 and writes no log line, because the "unknown account" message is logged at debug and the logger runs at log, warn and error. So a missing or unsubscribed account is silent to operators.
- **Cause established (H).** The earlier read-only diagnostics of the live Meta app show its webhook subscriptions list only the `page` object, with no `instagram` object subscription. Meta therefore never delivers Instagram messaging events to `/api/v1/webhook/messenger`. The production environment variables were confirmed complete in the same audit.
- **Required action (yours).** In the Meta app dashboard, subscribe the `instagram` object to the same callback URL and verify token, with the `messages` field. Then re-run `instagram-diagnostics-2.sh`.
- **Code defects found but not changed:** the debug-level log above; classic-login scopes omit `instagram_manage_messages` and `pages_manage_metadata` (only used when `INSTAGRAM_LOGIN_CONFIG_ID` is unset; production has it set); "Connected" is only the stored `isActive` flag; an event can fan out to every workspace holding the same account id.

### B. Digital Self and VerzAI
| Feature | Where | Status | Evidence |
|---|---|---|---|
| v2 pipeline (guard, context, prompt, generation, policy, escalation) | `ai-core/pipeline/` | PASS | U (215 quality scenarios, stage specs); boot test runs real stages with a stub provider |
| Prompt template 1.3.0, automatic upgrade, retired-wording guard | `ai-core/prompts/` | PARTIAL | U (59 tests, checksums pinned). Not exercised against a real database upgrade; real-model effect unmeasured |
| Workspace identity and personality (settings sync to the default agent) | `manage/settings/`, `ai-core/agents/` | PASS | U |
| Knowledge retrieval | `knowledge-base/`, `ai-core/pipeline/knowledge-context.source.ts` | PARTIAL | U; keyword retrieval only. Hybrid RAG is on another branch (14) |
| Memory: customer history 40 turns, cross-turn state | `context-assembly.stage.ts`, `conversations/conversation-state.service.ts` | PASS | U (window, fallback to 12 on unverified identity) |
| Tools and action execution | `ai-core/tools/` | PARTIAL | U; honest-claims check covers follow-up promises only |
| Human handoff before reply, verified outcome in the prompt | `messages.service.ts`, `prompts/handoff-context.ts` | PASS (mechanism) | U on all three responder paths. Wording with a real model NOT TESTED |
| Natural security refusals, isolation, rate limit | `ai-core/refusal/security-refusal.service.ts` | PASS (mechanism) | U; boot test; wording with a real model NOT TESTED |
| Failure handling: send no text, escalate | generation stage, `messages.service.ts` | PASS | U; **L**: with no model key, an inbound Instagram message produced no reply and the conversation moved to REQUESTED |
| Credit reservation, metering, zero-credit, top-up resume | `ai-core/credits/`, `completion/ai-metered-provider.service.ts` | **PASS** | U, DB-backed concurrency run **L**, activation at zero credits **L** |
| Admin AI sandbox (`POST /ai-logs/test`) | `ai-logs/` | PASS (API) / NOT TESTED (UI) | U; boot test runs it through the real pipeline. The AI Test page is hidden in production builds by the dev-tools gate |
| Legacy responder | `ai/ai-responder.service.ts` | PASS (compat) | U; still serves workspaces whose `verz_ai_v2` flag is off. Retirement is staged, not done |
| Readiness script `ai:legacy-readiness` | `scripts/`, `ai-core/migration/` | PARTIAL | Assessment logic U (14); the script compiles standalone but was not run against a database |
| Commerce AI | `commerce/ai/` | PASS (compat) | U; uses workspace personality and the shared identity |
| Digital Self (style learning, assignment, corrections) | `digital-self/` | PASS | U; **DB**: 21 integration tests against a real database and Redis |
| Provider failure, no canned replies | whole AI surface | PASS | static scan test (11 patterns, 2 recitation rules) plus U |

Retired and verified absent from production code: the four fixed replies (provider failure, handoff failed, tool-loop limit, human request), the fixed injection sentence, the scripted "great question / team will follow up" line, and the stale "AI assistant" openers.

### C. AI credits and payments
Credit packs are seeded by a migration: Starter 1,000 credits (GH₵10 / $5), Growth 3,000 (GH₵25 / $12), Pro 7,000 (GH₵50 / $25), Scale 15,000 (GH₵100 / $55).

| Behaviour | Status | Evidence |
|---|---|---|
| Pack listing, balance, history, usage screens | PASS | L, B |
| Starting a purchase (Paystack and Stripe initialisation) | BLOCKED | needs live provider keys; U only |
| Webhook signature check | PASS | L: forged signature returns 400 and grants nothing |
| Exactly-once credit grant | PASS | L: the same signed event delivered 3 times granted 1,000 credits once |
| Failed payment; late failure after success | PASS | L: failure marks the payment FAILED; a late failure cannot flip a succeeded payment |
| Reserve, deduct, release | PASS | L on real PostgreSQL |
| Insufficient credits | PASS | L: refused with no provider call |
| Admin credit grant, adjustments | PARTIAL | RBAC L (read-only admin 403); the grant itself U |
| Refund or reversal of a credit purchase | NOT TESTED | the ledger has `REFUND`/`ADJUSTMENT` types and an admin adjustment; no customer path exists |

### D. Commerce
| Behaviour | Status | Evidence |
|---|---|---|
| Products, draft orders, order items | PASS | L, B |
| Starting payment (Paystack initialise) | BLOCKED | needs live keys |
| Payment confirmation to PAID, ledger GMV and take-rate | PASS | L (signed webhooks) |
| Platform default percentage; workspace override | PASS | L: workspace 5% gave 6.17 on 123.45; after the admin set 10% the next order gave 12.35; with no workspace value the default 7% gave 8.64 |
| Percentage not applied twice | PASS | L: one TAKE_RATE entry per order; duplicate deliveries add nothing |
| Customer totals and prices unchanged | PASS | L: order total stayed 123.45; no checkout fee exists anywhere |
| Merchant proceeds deduction (model) | PASS | the take rate is a negative ledger entry out of the merchant's proceeds |
| Refund reverses the originally recorded rate | PASS | L through the application context: with the workspace now at 10%, a 50 refund on a 5% order reversed 2.50; the remaining 73.45 reversed 3.67 and the order moved to REFUNDED |
| **A refund can be triggered from the product** | **FAIL** | no route, job or webhook calls `recordRefund` (D3) |
| Underpayment | **FAIL** | S2 |
| Needs no subscription and no AI credits | PASS | U (runtime and static scan); L: Commerce screens and payments worked |
| Automatic payment-verification task | PASS | L: tasks appeared for paid orders |

### E. Subscription removal and the new model
- Current model: customers buy AI credits; Commerce earns its configured percentage; no monthly plans are sold. Subscription sales are switched off by `SUBSCRIPTION_SALES_ENABLED` (default off).
- **L:** `GET /billing/plans` returns `[]`; `GET /billing` carries no price field; the four routes that start a subscription (Stripe, Paystack, promo, trial) return 403 `SUBSCRIPTIONS_UNAVAILABLE`.
- **B:** the Billing screen shows usage, AI credits, packs and history, with no plan card for a free workspace.
- Preserved on purpose: subscriptions, plans, invoices and payments data; the payment webhooks (they can only complete a payment started earlier); the expiry cron; plan limits; the cancel option for existing paid subscribers.
- Remaining plan-based restrictions (verified): **1 agent** (a second invite returned 403 "Agent limit reached (1 on your plan)", L) and **campaigns** (blocked for free-plan workspaces by `limMaxCampaigns = 0`, code trace). The usage panel also shows "Templates 0 / 0" and "Campaigns 0 / 0" with full bars.
- Remaining wording to review: the terms of service still describe automatic renewal, cancellation and refunds.

### F. Workspace, team and platform administration
| Area | Status | Evidence |
|---|---|---|
| Registration, email verification, PIN, login | PASS | L, B (login form to PIN to dashboard) |
| Tenant isolation | PASS | L: a second workspace got 404 on another's conversation, order, product, contact and could not delete the product; lists showed only its own data |
| Platform-admin roles | PASS | L: read-only admin got 403 on prompt create and activate, workspace Commerce rate, platform default rate and credit grant, and 200 on reads; a tenant token got 403 on admin routes |
| Prompt administration | PASS | create and activate require SUPER_ADMIN (U, 20 authorisation tests; L) |
| Audit log | PASS | L: rows written for logins, failed logins and Commerce configuration changes |
| Commerce percentage administration | PASS | L: platform default and per-workspace override both working |
| Team and roles | PARTIAL | agent limit L; invitation flow beyond that NOT TESTED |
| Mobile app | NOT TESTED on device | T only |

### G. Public website and customer experience
Landing, book-demo, changelog, API docs, terms, privacy, GDPR, data deletion and status pages render (B). The SEO crawler passes 214/214 in production mode and 7/7 in wrong-host mode. Phone and tablet widths showed no horizontal overflow on the 8 public pages and 7 authenticated screens measured. Structured data no longer lists offers or prices.

### H. Infrastructure and operations
PostgreSQL, Redis, BullMQ queues, MinIO or local storage, nginx, Docker compose files (production, staging, dev) and shell scripts for deploy, backup, restore verification and SSL exist. See sections 10 and 12 to 14 for what was and was not exercised.

---

## 3. Architecture and integration overview
- **Backend (NestJS, Prisma, PostgreSQL):** REST under `/api/v1`, 65 controllers. Hosts three queue processors (AI evaluation, interaction evaluation, Digital Self learning) and one in-process credit reservation sweeper.
- **Worker:** 12 processors: campaign send, automation, message retry, snooze, AI trial, billing cron, SLA monitor, inactivity trigger, analytics and platform rollups, WhatsApp quality sync, Commerce reconciliation. All started in the local run.
- **Realtime:** socket server over Redis, JWT-authenticated.
- **whatsapp-web:** a separate service on the internal network only; nginx publishes ports 80 and 443 only.
- **Queues without any consumer:** `scheduled-campaign` (D1). `csat-survey` and `webhook-process` are declared and never used.
- **AI:** DeepSeek is the only provider; its URL is a constant in `common/deepseek.ts` and cannot be redirected for tests. Every paid call reserves credits first.
- **Web, mobile:** Next.js 14 and Expo.

## 4. Business model and billing behaviour (verified facts)
1. AI: a workspace may activate VerzAI at any balance (approval only). Replies are charged by tokens against the credit balance; an empty or insufficient balance stops chargeable replies; the AI stays enabled and resumes by itself after a top-up. Simulated test chats are unmetered.
2. Commerce: platform default percentage (seeded to 5% by a migration; raised to 7% in the local test) and a per-workspace override. The percentage is deducted from merchant proceeds. No customer fee, no markup on prices.
3. Subscriptions: not sold. Existing records are kept.
4. **Open business gap (decision needed):** every new workspace starts on the Free plan with 1 agent, 0 campaigns and 0 templates. A customer cannot change that, and a platform admin must edit the plan by hand. The landing and login pages still promise teams, campaigns and templates.

## 5. Verification matrix (summary)
| Area | Status | Strongest evidence | Missing |
|---|---|---|---|
| App boot, routes | PASS | L | none |
| Migrations from empty | PASS | L (94 applied) | production history differs (section 10) |
| Credits ledger and metering | PASS | L (DB, concurrency) | real provider |
| Payment webhooks (credits) | PASS | L (signed) | real Paystack |
| Commerce ledger and rates | PASS | L | real Paystack |
| Commerce amount check | FAIL | L | S2 |
| Refund trigger | FAIL | code trace | D3 |
| Subscription removal | PASS | L, B | existing-subscriber data |
| Tenant isolation, RBAC | PASS | L | exhaustive per-route audit |
| Instagram ingestion | PASS (code) | L | Meta delivery (external) |
| Digital Self wording | NOT TESTED | none real | real model |
| Provider failure | PASS | L | none |
| Web UI | PASS | B | platform-admin screens |
| Mobile UI | NOT TESTED | T | device |
| Backups, rollback | NOT TESTED | scripts exist | none run |

## 6. Test commands and actual results
| Command | Result |
|---|---|
| `npx jest` (backend, full) | 210 suites passed, 2 skipped; 3273 tests passed, 33 skipped (3306 total); 16 s |
| The 2 skipped suites, run against disposable databases | `digital-self.db.integration.spec.ts` 21/21 passed (with Redis); `media-library.db.spec.ts` 12/12 passed |
| `tsc --noEmit` backend, frontend, mobile, worker | 0 errors each |
| `next build` (production) | succeeded, 77 static pages |
| `node scripts/seo-check.mjs --mode production` | 214 passed, 0 failed |
| same, `--mode wrong-host` | 7 passed, 0 failed |
| `prisma migrate deploy` on an empty database | 94 migrations applied |
| `prisma migrate diff` migrations vs `schema.prisma` | 90 lines of drift (section 10) |
| Backend, worker, realtime run as built | all started; 0 errors in the backend and worker logs |
Not run: lint (no ESLint configuration exists in the backend, frontend or mobile apps), mobile or frontend unit tests (neither has a runner), end-to-end browser suites (none exist), the `whatsapp-web` service.
Subscription pricing and canned-reply source scans are enforced by `subscription-pricing-removal.spec.ts` (23 tests) and `no-canned-replies.spec.ts` (11).

## 7. Real-model, real-payment and real-provider evidence
- **Real model: BLOCKED.** No DeepSeek key is available in this environment, and the endpoint is hardcoded so it cannot be redirected to a stand-in. Needed: a test key on a staging stack, then the scenarios in `digital-self-staging-validation.md` (handoff, refusal, rate limit, parity, sandbox).
- **Real payment: BLOCKED.** No Paystack or Stripe test keys. Needed: sandbox keys on staging to run an actual credit purchase and an actual order payment.
- **Real Meta (WhatsApp, Messenger, Instagram) and real WhatsApp QR: BLOCKED.**
- **Historical (H):** on 2026-11-01 a staging test of v2 on a synthetic workspace found two of four executions rejected as malformed; the fix commits are in this branch's base (`9a52086`, `d5f93b9`) but have not been re-measured with a real model. The hybrid-RAG staging validation and the Instagram diagnostics are recorded in `~/verz-hybrid-rag-validation/`.

## 8. UI, browser and device findings
- Authenticated session driven in Chrome through the real login form (email, then PIN) to the dashboard.
- Billing: clean; no plan or price; AI credits, packs, usage and history visible.
- AI page: "VerzAI is active. AI replies are charged against your credits. Balance: 554 credits." The "How it works" step 3 still said a team member will follow up. **Fixed** (section 11).
- Dashboard, Inbox (shows the Instagram thread), Contacts, Commerce products and orders (paid orders listed), Tasks (payment tasks created), Campaigns, Templates, Channels, Settings, Account, Manage, Analytics, Library, Chatbot, Automation, Calls all rendered without errors.
- The Templates page made one failing call on load (`/templates/sync` returned 400) because no WhatsApp number is configured. Cosmetic in the local run (Low).
- `/ai-test` redirects to the inbox in a production-mode build (dev-tools gate). Intended, but it means the sandbox page was not seen.
- Findings: the Channels page promises "WhatsApp, Instagram, Facebook, TikTok, and Telegram", but the marketing data states TikTok and Telegram cannot receive or send messages (M2). The login page shows a testimonial attributed to "Sara M., Head of Support, GrowCo" with a specific claim (4 hours to 8 minutes) that cannot be traced to a customer, while the landing page states there are no customer quotes (M1).
- Not seen: platform-admin screens (API only), mobile app, dark theme.

## 9. Security findings
| ID | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| S1 | **High** | `/manage/settings/ai/trial-expired` and `/subscription-downgraded` check `x-internal-secret` only when `INTERNAL_SECRET` is set. No compose file, `.env.example` or workflow sets it, so in a deployment anyone can call them for any workspace id and trigger notifications and emails ("Your subscription has expired") to that workspace's admins. | code (`manage-settings.controller.ts`); grep of `infra/`, `deploy.sh`, `.github/`; the local run, with the secret set, returned 401 | Fail closed when the secret is empty, compare with a constant-time function, add `INTERNAL_SECRET` to the backend and worker service environments and to `.env.example`. Provision it before deploying. |
| S2 | **High** | The Commerce Paystack webhook marks an order PAID for whatever amount the signed event carries. The manual verify path rejects a mismatch; the webhook path does not, and checks no currency. | L: a signed 10.00 event on a 123.45 order gave status PAID and GMV 10 | Reject when `abs(amount - order total) > 0.01` or the currency differs; leave the order awaiting payment and log. |
| S3 | Medium | Credit-purchase webhook grants the stored credits without comparing the paid amount or currency. Signature protects it; a mismatch check is cheap defence in depth. | code | Compare against the purchase row. |
| S4 | Medium | Unknown or unsubscribed Meta account ids are logged at debug and never surface. | L | Log at warn with a rate limit. |
| S5 | Medium | `WHATSAPP_WEB_INTERNAL_API_KEY` fails open if unset. The key is forwarded in both compose files and the service is not exposed by nginx, so risk depends on provisioning. | code, compose | Fail closed in production. |
| S6 | Low | Access-token lifetime defaults to 30 days if `JWT_EXPIRES_IN` is unset. Both compose files set 15 minutes. | L showed 30 days locally | Keep the compose value; document it. |
| S7 | Low | CORS always allows `http://localhost:3000` and `:3001`. | code | Remove in production. |
| S8 | Low | Several env vars read by code are missing from `.env.example` (section 13). | diff of names | Document them. |
Checked and found sound:
- Signature verification for Paystack, Stripe, Commerce, Messenger and Instagram, and WhatsApp (production fails closed).
- Knowledge-base URL import resolves addresses and blocks private ranges (`public-page-fetch.ts` via `webhook-url.util.ts`).
- Socket authentication (L).
- Tenant isolation (L, 9 probes) and a consistent "scoped lookup, then write by id" pattern in the services spot-checked (templates, canned responses, knowledge base, segments, tags).
- Production secret check refuses default JWT secrets.
- `SKIP_2FA` and `SKIP_EMAIL_VERIFICATION` are not set in any compose file.
Not performed: destructive or fuzz testing, an exhaustive audit of all 439 routes, file-upload abuse testing, dependency vulnerability scan.

## 10. Data and migration risks
- All 94 migrations apply from empty. This branch adds **no migration**.
- **Schema drift (Medium).** The database the migrations produce differs from `schema.prisma`: legacy columns the model no longer lists (`canned_responses.category`, `conversation_events.metadata`, `feature_flags.rollout_type`, `platform_settings.updatedBy`), missing or extra indexes and foreign keys, and defaults. The earlier production audit also found production and staging differ in checksums and in 5 foreign keys and 6 indexes. Never run `prisma migrate dev` or `db push` against a real database.
- Migrations seed data: plans, credit packs and the default Commerce percentage (5%). A fresh install is therefore not empty.
- **Deploying this branch changes data once:** the first prompt use creates prompt version 1.3.0 and archives an untouched 1.1.0. Customised prompts only get a draft. An archived prompt cannot be re-activated by the API.
- `credit_purchases` stays `PENDING` after a failed payment while the payment itself is `FAILED` (Low).
- The refund and the platform-admin "commerce fees" report disagree on the meaning of a refund entry's sign (Low; unreachable today because no refund can start).
- Historical data untouched: no subscription, invoice, payment or ledger row was changed.

## 11. Fixes made during this review
Only copy fixes, each pinned by a test:
1. Landing page: removed three leftover plan phrases ("Free plan available." in the page description, the hero fine print, and the trust section). The guard test now covers those files.
2. AI page: "How it works" step 3 no longer says a team member will follow up; it says the conversation is handed to your team.
No code behaviour was changed in this review. The defects below are documented, not fixed.

## 12. Known defects and incomplete work
| ID | Severity | Item |
|---|---|---|
| D1 | High | **Scheduled campaigns never launch.** The backend queues `launch-campaign` on `scheduled-campaign`; no processor in the backend or worker consumes that queue. The campaign stays SCHEDULED. Pre-existing. |
| D2 | High | Plan limits on a new workspace (1 agent, 0 campaigns, 0 templates) cannot be changed by the customer. Decision needed. |
| D3 | Medium | No route, job or webhook can start a Commerce refund (`recordRefund` has no caller), so refunds made in the payment dashboard never reach the ledger. |
| D4 | Medium | Instagram does not deliver in production until the Meta subscription is added (2A). |
| D5 | Medium | Existing documentation is stale: `VERZCHAT_AI_IMPLEMENTATION_PROGRESS.md` and `verz-ai-conversation-quality.md` still describe the retired fixed replies and the apology cooldown. |
| D6 | Medium | Login testimonial and Channels-page claims (section 8). |
| D7 | Medium | No lint configuration anywhere, and no frontend or mobile test runner. |
| D8 | Low | Usage meters show full bars at `0 / 0` for templates and campaigns, and red "100% used" for new workspaces. |
| D9 | Low | Legacy responder still serves workspaces with the v2 flag off; the retirement plan is staged (`legacy-responder-retirement-plan.md`). |
| D10 | Low | Memory depth is 40 turns (legacy remembered 200); billing is token-metered (legacy was a flat hold). |
| D11 | Low | The terms of service describe renewal and refunds for plans that are no longer sold; legal review needed. |
Uncommitted work in this worktree, by area: AI pipeline and prompts (`ai-core/`, `ai/`, `ai-logs/`, `messages/`, `commerce/ai`, `commerce/evaluation`); prompt authorisation; credits and Commerce ledger fix; subscription switch (`billing/`, `manage/`, `users/`, `campaigns/`); web, mobile and shared client (`apps/frontend`, `apps/mobile`, `packages/api`); `infra/.env.example`; 40 new or updated spec files. Build artefacts created for this review were deleted.

## 13. Environment variables and deployment prerequisites
Names only. Documented in `infra/.env.example`: DOMAIN, FRONTEND_URL, PUBLIC_URL, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SOCKET_URL, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, REDIS_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, STORAGE_DRIVER, the AWS and MinIO settings, THROTTLE_TTL, THROTTLE_LIMIT, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_LOGIN_CONFIG_ID, INSTAGRAM_LOGIN_CONFIG_ID, MESSENGER_WEBHOOK_VERIFY_TOKEN, OAUTH_STATE_SECRET, WHATSAPP_WEB_INTERNAL_API_KEY, TikTok keys, RESEND_WEBHOOK_SECRET, SUBSCRIPTION_SALES_ENABLED (new), STRIPE and PAYSTACK keys.
Read by the code but **not documented** there: INTERNAL_SECRET (**missing from every deployment file, S1**), CREDENTIALS_ENCRYPTION_KEY, DEEPSEEK_API_KEY, WHATSAPP_APP_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, PLATFORM_ADMIN_SETUP_SECRET, REDIS_HOST, REDIS_PORT, BACKEND_URL, BACKEND_INTERNAL_URL, REALTIME_URL, REALTIME_INTERNAL_URL, WHATSAPP_WEB_INTERNAL_URL, MINIO endpoint settings, LOG_LEVEL, GHS_RATE. The compose files do forward DEEPSEEK_API_KEY, CREDENTIALS_ENCRYPTION_KEY, WHATSAPP_APP_SECRET, SMTP_HOST, JWT_EXPIRES_IN and PLATFORM_ADMIN_SETUP_SECRET (checked by name); they forward neither INTERNAL_SECRET nor SKIP_2FA/SKIP_EMAIL_VERIFICATION (the last two are correctly absent).
Prerequisites: set `SUBSCRIPTION_SALES_ENABLED` to false or leave it unset; provision `INTERNAL_SECRET`; confirm Paystack and Meta webhook secrets on the target; confirm the Meta `instagram` webhook subscription.

## 14. Migration and rollout sequence
1. **Integrate first.** The hybrid-RAG branch (4 commits, 49 files, built on the same base) is what staging runs. It overlaps this branch in 7 files: `ai-core.module.ts`, `pipeline.types.ts`, `context-assembly.stage.ts` and its spec, `generation.stage.ts` and its spec, and `tool-calling.execution-record.spec.ts`. Deploying this branch alone removes hybrid retrieval. Merge or rebase, resolve, then rerun the full suite.
2. Fix S1 and S2 (and decide D1 and D2). Update `.env.example`.
3. Commit through the normal path (feature to staging to main) with a SemVer version, per project policy.
4. Staging: deploy backend only with the existing gated script; the prompt upgrades itself on first use (verify with `server-prompt-version-check.sh`; expect one ACTIVE 1.3.0, md5 `8e9c4768f3e751b851cb36e78de4ebee`).
5. Run `digital-self-staging-validation.md` with a real key; run a real Paystack sandbox credit purchase and order payment.
6. Run `pnpm run ai:legacy-readiness` (dry run) and turn `verz_ai_v2` on per workspace, pilot first. Do not remove the legacy responder in this release.
7. Production: same sequence after its own approval; compare production migration history first.

## 15. Rollback strategy
- Code: redeploy the previous image tag (the staging script keeps candidate directories and image tags).
- Subscription sales: set `SUBSCRIPTION_SALES_ENABLED=true` (backend) and restore the removed frontend files from git; no data change is involved.
- Prompt: the previous version is archived, not deleted; to go back, create a new version from its body and activate it (SUPER_ADMIN). Note the serving guard ignores a stored prompt that scripts a fixed reply.
- Workspaces moved to v2: switch their rollout row off; the legacy path stays in the code.
- Data: this branch adds no migration and rewrites no historical rows, so no database rollback is needed. A pre-release dump (`infra/scripts/backup.sh`, `staging-phase-a-backup.sh`) is still recommended; restore verification script exists (`staging-verify-backup-restore.sh`) but **was not run**.

## 16. Post-release monitoring checklist
- Backend and worker error rate; the log line "still answered by the legacy responder" (should shrink to zero); "serving the built-in" prompt warning (should never appear after upgrade).
- Credit ledger: grants equal confirmed payments; no negative balances; open reservations return to zero.
- Webhook events marked FAILED (Paystack, Commerce, Messenger, Instagram); Meta delivery of Instagram events after the subscription is added.
- Commerce: ledger GMV equals paid orders; take-rate share matches configuration; any order whose paid amount differs from its total.
- Reply quality sample: handoff acknowledgements, refusals, no canned phrases; handoff failures; empty-reply escalations by cause.
- Queue depth and age for every queue, including a check that `scheduled-campaign` has a consumer once D1 is fixed.
- Support signals: customers hitting the 1-agent and campaign limits.

## 17. Release decision and blocker list
**Decision: NOT READY for production.** Staging deployment is READY WITH CONDITIONS: complete steps 1 and 2 of the rollout sequence first.

| Priority | Item | Why |
|---|---|---|
| Critical | None found | |
| High | S1 `INTERNAL_SECRET` fail-open | unauthenticated trigger of customer-facing emails |
| High | S2 Commerce underpayment accepted | money correctness |
| High | Integration with the hybrid-RAG branch | deploying this branch alone removes hybrid retrieval on staging |
| High | Real-model verification of 1.3.0, handoff and refusals | the central customer experience has no real-model evidence |
| High | Real Paystack sandbox verification | webhook behaviour proven only with locally signed requests |
| High | D1 scheduled campaigns | feature does not work |
| High | D2 plan limits for new workspaces | business decision, affects every new customer |
| High | D4 Instagram subscription in Meta | external action, required for Instagram to work |
| Medium | D3 refunds, S3, S4, S5, schema drift, D5, D6, D7 | schedule |
| Low | S6, S7, S8, D8 to D11, templates sync call | cosmetic or future |

What would move this to READY WITH CONDITIONS: S1 and S2 fixed and tested; the branches integrated and the full suite green; D2 decided; one real-model and one real-payment pass on staging. D1 and D4 can ship as known limitations if stated.

## 18. Verified facts versus assumptions
Verified in this review: everything tagged L, DB, B or T above.
Assumed or taken from history (H): the Meta app subscription state, production migration history, staging running the hybrid-RAG build, the 2026-11-01 staging v2 result.
Recommendations (not verified): the S1 to S5 patches, the rollout order and the monitoring list.
