# VerzChat AI phase: implementation progress

Permanent source of truth for the AI-phase mission. Read this first in every session, then `git status`, then continue from
"Next actions". Statuses: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED`, `VERIFIED`, `ACCEPTED`.
`IMPLEMENTED` means code exists; `VERIFIED` means there is evidence listed in this file. Nothing here is `ACCEPTED`.

Highest product priority (applies to every phase): natural, human-quality conversation. No change may trade it away for
automation, evaluation scores or rigid prompts. See "Naturalness" below.

## 1. Repository state (start of mission, session 1)

| Item | Value |
|---|---|
| Working repo | `/Users/breezyyy/verz-platform-admin` |
| Branch | `feature/ai-phase-completion` (created from `origin/staging`, upstream unset, never pushed) |
| Base commit | `5ff4a0e` (= `origin/staging`: "fix(ai-learning): bound judge retries and make evaluation writes and review tasks idempotent") |
| Other local-only branches | `feature/ai-eval-safety-hardening` (4 commits, tip `76ecaae`, independent evaluation framework `apps/backend/src/ai-eval`, not on staging), `feature/ai-learning-retry-idempotency` (`4629aff`, same content as `5ff4a0e`, stale `dev` base, redundant) |
| Stash | `stash@{0}` "pre-existing uncommitted work (landing/mobile assets)": not touched, do not touch |
| Disposable test DB | Docker container `verz-ai-learning-it-pg`, `127.0.0.1:55432`, db `verz_ai_learning_it_test`, tmpfs. Credentials only in the session scratchpad, never in the repo. Migrations (92 on this tree) applied. |
| Production | untouched. `main` not touched. Nothing pushed by this mission. |

Authorization boundaries in force: no push to `main`, no production deploy or data change, no force-push, no live model calls in
ordinary tests, no secrets in logs or the repo. Pushing the feature branch and any staging deploy still need an explicit go-ahead.

## 2. Existing AI architecture (audited in session 1, code-level)

- **Reply generation (auto-reply)**: `messages/messages.service.ts` `handleAiAutoReply` (suggestion mode: `handleAiSuggestion`).
  `generateAiReply` selects: Commerce AI (`commerce/ai/commerce-ai.service.ts`) when commerce is enabled; the v2 pipeline
  (`ai-core/pipeline/verz-ai-pipeline.service.ts`, stages incl. `generation.stage.ts`) when feature flag `verz_ai_v2` is on for the
  tenant; otherwise the legacy `ai/ai-responder.service.ts` `generateSuggestion` (DeepSeek via axios, `common/deepseek.ts`).
- **Provider failure handling**: the legacy responder swallows every error into `{ response: '' }`
  (`ai-responder.service.ts:292-294`); v2 and Commerce return `PROVIDER_FAILURE_FALLBACK_TEXT` with `shouldEscalate`.
  Texts live in `ai-core/prompts/escalation-messages.util.ts`.
- **Human ownership / takeover**: `isConversationHumanHandled` re-reads ownership from the DB before the paid call, before
  delivery, before the fallback, before the escalation reply, and before each media send. It fails closed. Dispatch decision:
  `ai-takeover.util.ts` (`isAgentAway`, opt-in per tenant). `runExclusiveForConversation` is an in-process promise chain, so it
  assumes a single backend replica (stated in code). The code itself documents an unavoidable window between the last DB check
  and the channel send.
- **Queues / processors**: only two: `AI_INTERACTION_EVAL` (`ai-learning/ai-interaction-eval.processor.ts`) and `AI_EVAL_RUN`
  (`commerce/evaluation/evaluation.processor.ts`).
- **Learning data model (Prisma)**: `AiInteractionLog`, `AiExecution`, `AiInteractionEvaluation` (unique per execution),
  `AiEvaluationFeedback`, `AiTrainingExample` (DRAFT/APPROVED lifecycle, manual "regression case" marker), `AiCustomerCorrection`,
  `AiLearningAuditLog`, `AiPromptTemplate` / `AiPromptVersion`, `KnowledgeBaseArticle`, `FeatureFlag` / `FeatureFlagRollout`.
  There is **no** learning-candidate, verification-run, baseline-comparison, activation or rollback model.
- **Flags**: `verz_ai_v2` (pipeline), `ai_learning_system` (evaluation, opt-in per tenant, fail-closed when no row exists).
- **Frontend**: `/ai` page with `AiLearningTab` and `AiActivityTab`, `/ai/test-chat`, `/ai-pending`. No candidate review or
  version/rollback UI.
- **Independent evaluation framework** (`apps/backend/src/ai-eval`: deterministic checks, gate, capped baseline-vs-candidate
  comparison, spend guard, sanitizer): exists only on the local branch `feature/ai-eval-safety-hardening`. Its paid path is closed
  by design until DeepSeek's reasoning-token billing is established.
- **Knowledge base**: no outbound URL fetching found in `knowledge-base` or `ai` modules by grep (`UNVERIFIED`: ingestion paths
  not yet traced). A webhook SSRF helper exists at `manage/webhooks/webhook-url.util.ts`.

## 3. Confirmed defects and gaps

| # | Finding | Severity | Status |
|---|---|---|---|
| D1 | Provider outage repeated the same apology + handoff request on every customer message (observed on staging with an invalid key) | High (customer-facing) | `VERIFIED` fixed, see 5.1 |
| D2 | Staging `DEEPSEEK_API_KEY` is rejected by the provider (HTTP 401 on every responder call) | Blocker for any AI test on staging | `BLOCKED`: needs a valid key from the owner |
| D3 | The legacy responder never recorded an `AiExecution` (`executionId: null`), and Commerce AI discarded the id of the execution `ToolCallingService` did record. Neither reply could be linked to its interaction log, so neither could ever be evaluated, and legacy outages left no trace (no `ai_executions` rows after 2026-10-24 despite many 401s). Confirmed by reading the code. | High (evaluation was inert for legacy and Commerce workspaces) | `VERIFIED` fixed, see 5.2 |
| D10 | AI Test Chat sent its synthetic customer message through the real `MessagesService.handleInbound`, so in auto-reply mode the AI reply went to the real channel sender with a fake phone number (Meta `131009`), was logged `AUTO_SENT`, and the page labelled it "Suggested, not sent" (the service reported `SUGGESTION` whenever any log existed). Confirmed by reading the code. | High | `VERIFIED` fixed, see 5.3 |
| D12 | Simulated (Test Chat) turns are now unmetered, which also makes them free: a tenant user can generate unlimited real DeepSeek calls through the test chat. There is no cap. | Medium | `VERIFIED` fixed, see 5.4 (the numeric defaults are proposals and still need a product decision) |
| D11 | Fixed wording remains in the legacy prompt (`"That's a great question! Our team will follow up with you shortly."`, `"Address the customer by name"`) and in the shared fallback texts. The Phase 2 hardcoded-response audit is not done. | Medium | `NOT_STARTED` |
| D4 | `ai-learning` judge: no spend cap or usage accounting, no input redaction or length caps, no prompt-injection delimiting, `max_tokens: 500` under an unverified thinking default | Medium | `NOT_STARTED` (F1, F4, F5, F6 from the earlier review) |
| D5 | Review-task uniqueness is serialization-enforced, not a DB constraint (`InternalTask` has none) | Low | accepted limitation, documented |
| D6 | `runExclusiveForConversation` and the client-send dedupe are per-process; a second backend replica would break their guarantees | Medium (latent) | `NOT_STARTED` |
| D7 | No learning-candidate pipeline, verification gate, versioned activation or rollback | Missing feature | `NOT_STARTED` |
| D8 | Staging Redis runs without `requirepass` while clients send `REDIS_PASSWORD`: harmless "does not require a password" warning, Redis not published outside the compose network | Low | `NOT_STARTED` (needs staging infra change, owner approval) |
| D9 | Staging MinIO rejected the backend key (volume created with an older key) | Was blocking uploads | fixed on staging by recreating MinIO (owner action), verified: error gone |

## 4. Phases and acceptance status

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit the existing system | `IN_PROGRESS`: reply path, takeover, queues, models, frontend inventoried; knowledge ingestion, credits, retention not yet traced |
| 1 | Reliable AI foundation (provider abstraction, validation, retries, instrumentation) | `IN_PROGRESS`: D1, D3, D10 and D12 done; D4, D6 open |
| 2 | Correct and safe conversations, takeover | `IN_PROGRESS`: takeover rechecks exist and are tested; Test Chat is now an isolated simulation (5.3); no new takeover concurrency work yet |
| 3 | Learning pipeline (candidates, verification, review, versions) | `NOT_STARTED` beyond the evaluation reliability work already on staging |
| 4 | Measured outcome feedback loop | `NOT_STARTED` |
| 5 | Knowledge and retrieval security | `NOT_STARTED` |
| 6 | Product surfaces | `NOT_STARTED` |
| 7 | Security, reliability, cost controls | `NOT_STARTED` |
| 8 | Testing and evidence | `IN_PROGRESS`: see section 6 |
| 9 | Staging verification | `BLOCKED` on D2; partial findings in section 7 |
| 10 | Final release-readiness | `NOT_STARTED` |

Naturalness (cross-cutting, highest priority): `NOT_STARTED` as a measured criterion. Existing assets to build on: PR #136
conversation-quality work and `apps/backend/src/ai-core/quality` (scenario harness), plus the `ai-eval` assertions on the local
branch. Needed: a naturalness rubric (repetition, templated openings, over-politeness, list abuse, context loss, tone match)
with deterministic checks first, a blinded baseline-vs-candidate comparison that does not use the generating model as the only
judge, and a rule that a candidate which raises accuracy but lowers naturalness cannot pass without explicit review.

## 5. Work completed

### 5.1 D1: provider-outage apology is no longer repeated  (`IMPLEMENTED` + `VERIFIED`)

Files: `apps/backend/src/messages/messages.service.ts`, `apps/backend/src/messages/messages.service.spec.ts`.

Behaviour: in `handleAiAutoReply`, when the reply is a provider failure (empty response, or the shared
`PROVIDER_FAILURE_FALLBACK_TEXT` from v2/Commerce) and this conversation already received such an apology **with a successful
handoff request** in the last 15 minutes, nothing more is sent and no further handoff is requested. A normal reply, a recovered
provider, a genuine human-request escalation and a human takeover are unaffected. The apology message is persisted with
`metadata.fallback` and `metadata.handoffRequested` so a repeat can be recognised. If the earlier handoff failed, the next
failure is not suppressed. A failed lookup fails open (apology sent as before), never a silent customer on a DB error.

Evidence:
- Unit: `messages.service.spec.ts` 92 tests pass (83 before, 9 new covering first failure, suppressed repeat, lookup scoping and
  window, recovery, failed-handoff marker, fail-open lookup, v2/Commerce path, genuine escalation, takeover).
- Mutation checks (7): suppression removed, time window removed, handoff condition removed, tenant scoping removed, v2 text not
  recognised, escalation outcome not recorded, fail-closed lookup. All caught; file restored byte-identical.
- Real PostgreSQL 16 (disposable container): the exact Prisma JSON-path query was run against seeded rows: 8/8 cases correct
  (no row, normal reply, handoff failed, inbound, older than 15 min, other conversation, recent flagged match, isolation).
  Test data deleted afterwards.
- Not yet verified: behaviour on the real staging stack (blocked by D2; needs a valid provider key and a deploy).

Limitations: the 15-minute window is a constant; the customer gets silence (not a second message) while a handoff is open.
Whether a second, differently worded acknowledgement is better is a product decision to review with the naturalness criteria.

### 5.2 D3: every AI reply path is now traceable and evaluable  (`IMPLEMENTED` + `VERIFIED`)

Files: `messages/messages.service.ts`, `messages/legacy-ai-execution.util.ts` (new), `ai-core/executions/ai-executions.service.ts`,
`ai-core/tools/tool-calling.service.ts`, `commerce/ai/commerce-ai.service.ts`, `ai-learning/ai-learning-trigger.service.ts`
(and their specs; `messages/legacy-ai-execution.util.spec.ts` is new).

What changed:
- **Legacy responder**: each turn is recorded as an `AiExecution` (`RESPONDER`) and the id is returned, so the interaction log can be
  linked and the evaluation job can resolve it. The responder itself is untouched; the call is observed from outside. The record holds
  only real data: the provider's own `usage` tokens (absent, never zero or estimated, when the provider sent none), the measured
  latency, the confidence, and a safe error code (`http_401`, never a body or header). Statuses are honest: `SUCCESS` only when the
  provider answered and a clean reply came out; `EMPTY` (`output_rejected`) when it answered but the output was dropped;
  `PROVIDER_ERROR` for a failed call or no API key (`not_configured`); `BLOCKED` for an injection block. No cost is invented.
- **No double charge**: `AiExecutionsService.record` gained `opts.meterCredits`. The legacy path passes `false` because its provider
  call is already charged by its own flat reservation. Default behaviour (v2, background tasks) is unchanged.
- **Commerce AI**: `ToolCallingService` already recorded an execution but threw the id away. It now returns it
  (`ToolCallingResult.executionId`), Commerce passes it on, and `MessagesService` links it. No second record is made.
- **Evaluation trigger**: only a `SUCCESS` execution is queued. A blocked, empty or failed execution has no reply to grade and would
  only create a job that retries and fails. Callers that pass no status are unchanged.
- A failure to record never blocks the customer's reply (logged only).

Evidence:
- Unit: `messages.service.spec` 104 pass (12 new: legacy success/error/blocked/empty/no-usage/record-failure, credits not
  double-charged, suggestion mode, human-request makes no execution, Commerce linking, v2 unchanged); `legacy-ai-execution.util.spec`,
  `ai-executions.service.spec` (+4), `ai-learning-trigger.service.spec` (+5), `tool-calling.service.spec` (+4),
  `commerce-ai.service.spec` (+4). One existing test asserted the old behaviour ("forcing executionId null") and was updated to the
  new contract.
- Mutation checks (9): credits always metered, unmetered flag dropped, Commerce id dropped, trigger not gated, tool-calling id dropped,
  usage not captured, error not captured, empty reply can be SUCCESS, record failure not tolerated. All caught; files restored byte-identical.
- Real PostgreSQL 16 (disposable container), real `AiExecutionsService` + real `InteractionContextResolver`, 8/8: the legacy row
  persists with the real tokens, latency and confidence and a null cost; no credit settlement happens; the trigger is told the status;
  an unlinked execution is NOT resolvable; after `linkInteractionLog` the evaluation resolver resolves it with the right customer
  message and reply; resolution is tenant-scoped; failure and block records persist as `PROVIDER_ERROR`/`http_401` and `BLOCKED`.
  Test data deleted afterwards.
- Not verified: on the staging stack (needs a deploy). Because staging workspaces use the legacy path, evaluation was inert there
  before this change; after deploy a flagged tenant's replies should produce evaluation rows.

Known limitations: the legacy record is made after the responder returns, so a crash between the provider call and the record loses
the record (the reply path is unaffected). Execution rows now exist for legacy turns that have no linked log yet; the evaluation job
already tolerates that with its retry/backoff.

### 5.3 D10: AI Test Chat is an isolated simulation  (`IMPLEMENTED` + `VERIFIED`)

Design: a simulated customer is a number in a **reserved range** (`+000` followed by 10 digits; no real number can be in it because no
country code begins with 0). The identity is the number alone, never a flag a tenant user can edit, so a real customer can never be
silently muted. Every layer that can reach a provider recognises the range and refuses; the application layer additionally
**simulates** (generates, stores and evaluates) instead of delivering.

Layers:
1. `packages/shared-utils/src/simulated-recipient.ts` (new): `simulatedPhoneFor`, `isSimulatedPhone`, `assertNotSimulatedRecipient`,
   `SimulatedRecipientError`. One definition used by Test Chat, the backend and the worker, so they cannot drift.
2. Provider boundary (defence in depth): all 8 WhatsApp Cloud send methods and both WhatsApp Web senders in the backend refuse the
   number before credentials are read or a request is built. The worker's direct Graph sends (retry, campaign, automation) refuse it
   too (retry returns quietly and never resolves credentials; campaign and automation fail the item with the explicit reason).
3. Application: `dispatchOutbound` throws `SimulatedRecipientError` for every channel type, whoever calls it (bot flow, a human typing in
   the Inbox, a retry). `sendAiText` reports a simulated delivery (`QUEUED`, no provider id, no `sentAt`, never `SENT`). The welcome
   message, CSAT thank-you and bot-flow steps store a simulated message instead of calling a provider and marking it `FAILED`.
4. Statuses: `AiInteractionLog.status = 'SIMULATED'` (free-text column, no migration); the stored message is `QUEUED` with
   `metadata.simulated = true`. A reply is never `AUTO_SENT` or `SENT`. `SIMULATED` logs are ignored by the AUTO_SENT/SUGGESTED analytics.
5. Credits and agents: a simulated turn runs as the existing unmetered `TEST` task (legacy: no credit hold; v2 and Commerce: task type
   `TEST`), so no customer credits are settled. No real handoff is requested (no staff notified, no assignment changed). Lead scoring
   (a paid call) is skipped. The execution is tagged `safetyFlags.simulated`, and the evaluation trigger evaluates a `TEST` run only
   when it is tagged, so simulated replies are still graded and no other TEST run (sandboxes, harnesses) is.
6. Test Chat service: the reported mode comes from what was recorded (`SUGGESTION` | `SIMULATED` | `TIMEOUT` | `ERROR`); an
   `AUTO_SENT` log or an unmarked outbound message in a simulated conversation is an `ERROR` that says so, never a "suggestion".
7. Page: simulated replies are labelled "Simulated reply, not sent to any channel" and no longer appear twice (the log duplicate was
   removed); the header no longer claims auto-reply messages are real.

Files: `packages/shared-utils/src/{simulated-recipient,index}.ts`; backend `messages/messages.service.ts`,
`messages/legacy-ai-execution.util.ts`, `whatsapp/whatsapp.service.ts`, `whatsapp-web/whatsapp-web.service.ts`,
`ai-core/{executions/ai-executions.service,pipeline/pipeline.types,pipeline/verz-ai-pipeline.service,pipeline/stages/generation.stage,tools/tool-calling.service,test-chat/ai-test-chat.service}.ts`,
`commerce/ai/commerce-ai.service.ts`, `ai-learning/ai-learning-trigger.service.ts`, `ai-logs/ai-logs.service.ts`; worker
`processors/{message-retry,campaign-send,automation}.processor.ts`; frontend `ai/test-chat/page.tsx`; new
`test/ai-test-chat-simulation.e2e-spec.ts`. No Prisma schema change and no migration.

Evidence:
- Unit: new or extended specs for the shared predicate (formats, near-misses, non-strings, a 2000-seed fuzz of the range), all 8
  WhatsApp Cloud methods and both Web senders refusing before any credential or request, `MessagesService` (21 tests: no provider
  invoked on any path, statuses, credits, handoffs, media, bot flows, welcome message, the delivery door on 4 channel types, real-customer
  contrasts), Test Chat modes (20), v2/Commerce/tool-calling/generation-stage tagging, the execution recorder and the trigger.
- Mutation checks (8) on the application layer, each run against the unit suite and the real-DB spec: all caught by the unit suite,
  7 of 8 also by the real-DB spec (lead scoring is only covered by unit tests). Files restored byte-identical.
- Real PostgreSQL 16 (disposable local container), `test/ai-test-chat-simulation.e2e-spec.ts`, 7/7: the real `MessagesService` reply
  path, real persistence, real execution recorder, real trigger and real `AiInteractionEvalProcessor`, with every messaging provider a
  spy. A simulated reply is stored `QUEUED`/simulated, logged `SIMULATED`, moves no credits and calls no provider; the execution is a
  `TEST` run tagged simulated with the real token counts and linked to the log; it is queued with the stable job id and the real
  processor writes an `EVALUATED` evaluation; an escalation requests no handoff and leaves the conversation `OPEN`/unassigned;
  suggestion mode stays a `SUGGESTED` draft; tenant isolation; and a real customer is unchanged (sent, `SENT`, `AUTO_SENT`, metered, `RESPONDER`).
- Worker (no test runner exists there): the real processors were exercised with a fake database and a spy on the Graph call, in a
  throwaway script that is not committed. Retry: no call and no credential lookup. Automation (both messaging actions): refused with
  `SimulatedRecipientError`. Campaign: the control shows a real number reaches the call, the simulated one does not and is recorded
  `FAILED` with the explicit reason.

Limitations and follow-ups:
- `Message.status` has no `SIMULATED` value, so a simulated message is `QUEUED` plus a marker (kept in one constant,
  `SIMULATED_MESSAGE_METADATA`). A real enum value is cleaner but needs a reviewed migration (`ALTER TYPE ... ADD VALUE`) and a
  strict rollout order: migrate first, deploy second, never roll the app back below it once rows exist, because an older Prisma client
  fails to read a row with an enum value it does not know. Decide before doing it.
- The test conversation and its contact are real rows. They still appear in the real Inbox (a simulated message there is not yet badged)
  and in message counts. Separating them in the Inbox and analytics is not done.
- The page change is verified by `tsc` only; there is no frontend test runner and it has not been viewed in a browser.
- The campaign/retry/automation guards have no committed tests (the worker has no runner); they are covered by the throwaway check above.
- Existing `FAILED` messages from earlier Test Chat sessions remain; the retry worker now ignores them.
- Deploying this needs the backend, worker and frontend images rebuilt (and `shared-utils` is built into them by the Docker build).

### 5.4 D12: safe usage limits for simulated AI  (`IMPLEMENTED` + `VERIFIED` locally, uncommitted until reviewed)

Problem: simulated turns call the real paid model but settle no customer credits, so before this change a tenant user could generate
unlimited provider cost through the test tools.

Audit (entry points that reach a paid model without a customer):

| Entry point | Protection before | Protection now |
|---|---|---|
| `POST /ai/test-chat/message` (AI Test Chat) | HTTP throttle per IP, in memory | per-user/min + per-tenant/day atomic quota, input and history caps, idempotent request id |
| Commerce Test Chat | metered as before | same quota and caps, same idempotency |
| AI sandbox (`ai-logs`, behind `DevToolsGuard`) | dev-tools flag | same quota |
| Commerce evaluation runs (about 15-20 scripted conversations each) | none | runs/day cap plus one active run per tenant |
| AI Learning judge on a simulated reply | none | judge-gradings/day cap; when spent or the store is down the judge is skipped, not run |

Design:
- Counters live in Redis (already required by BullMQ; the connection is borrowed from the existing queue, no new dependency). A single
  Lua script checks every counter and then increments all of them or none, so concurrent requests, on any replica, cannot overshoot.
  Postgres counting was rejected: it is not atomic without holding row locks across a ~20 s provider call. The in-memory throttler is
  per process and per IP, so it is kept only as the outer layer.
- Fail closed: if Redis is unreachable the request is refused with 503 `SIMULATION_LIMITS_UNAVAILABLE`; a spent allowance returns
  429 `SIMULATION_LIMIT_REACHED` with scope, limit, used and `retryAfterSeconds`. Neither path falls back to a real channel or to another
  provider; the provider is never called.
- Idempotency: an optional `clientMessageId` (8-64 chars `[A-Za-z0-9_-]`). The first request claims it; a completed result is stored
  and replayed on retry (no provider call, no quota); an in-flight duplicate gets 409 `SIMULATION_REQUEST_IN_PROGRESS`; a request that
  already ran and failed gets 409 `SIMULATION_REQUEST_ALREADY_PROCESSED` instead of re-spending. An id is released when a limit or
  precheck refused the request before any provider call, so the user can retry it later.
- Accounting: usage is read from stored `AiExecution` rows (`taskType TEST`, `safetyFlags.simulated`). Tokens are only what the provider
  reported; cost is the stored estimate or the model-catalog rate, labelled as not provider-verified, and `costEstimateComplete` says
  when any row lacked data. Nothing is invented. These rows stay outside customer-credit settlement (unchanged `TEST` rule).
- Admin visibility: `GET /ai/test-chat/usage` (tenant-scoped from the authenticated user, never from a client value) returns the tenant's
  limits, used counts and the estimate; no secrets, no other tenants. The Test Chat page shows a usage line.
- Simulated recipients: the reserved fake-number predicate was widened to the Commerce Test Chat format (`+000TEST` plus 10 hex).

Configuration (no database migration): built-in defaults, then `AI_SIM_*` env, then per-tenant `AI_SIM_TENANT_OVERRIDES` (JSON). Values
are validated and clamped to hard ceilings; an invalid value is ignored with a warning naming the setting only; `0` switches a scope off.
Documented in `infra/.env.example`.

| Limit | Default | Ceiling | Rationale (proposal, not a production requirement) |
|---|---|---|---|
| `AI_SIM_DAILY_REQUESTS` (tenant/day) | 200 | 5000 | a QA team stepping through the bot by hand; about 200 short turns is a few cents of model cost |
| `AI_SIM_USER_PER_MINUTE` | 5 | 60 | faster than a person types a realistic message, slower than a script |
| `AI_SIM_MAX_INPUT_CHARS` | 1000 | 4000 | a long customer message; ceiling is the WhatsApp text maximum |
| `AI_SIM_MAX_CONVERSATION_TURNS` | 40 | 200 | bounds the history sent to the model |
| `AI_SIM_DAILY_EVALUATIONS` (judge) | 100 | 5000 | judge calls are the costlier unit per turn |
| `AI_SIM_DAILY_EVAL_RUNS` | 3 | 50 | each run is a batch of scripted conversations |
| `AI_SIM_IDEMPOTENCY_TTL_SECONDS` | 900 | 3600 | covers a client retry window |

Product decisions still needed: the numeric defaults above; whether per-tenant limits should be editable in an admin UI (needs a
migration) rather than env JSON; whether a platform admin needs a cross-tenant usage view; whether to verify catalog prices against the
provider invoice before showing cost to tenants.

Evidence (real results, local, no provider call, no network):
- Unit: simulation directory 94 tests; test-chat 48; commerce, ai-logs, ai-learning and ai-core suites green.
- Real Redis (disposable local container): `test/ai-simulation-limits.e2e-spec.ts` 16/16, exact counts under 8-connection contention,
  atomicity, expiry, idempotent replay, fail-closed.
- Real Postgres (disposable local container): `test/ai-test-chat-simulation.e2e-spec.ts` 11/11, including usage accounting and a real
  customer remaining metered and sent.
- Mutation: 16/16 mutants caught (including a non-atomic Lua script, visible only to the real-Redis spec).
- Full backend suite: 160 suites passed, 1 skipped; 2376 tests passed, 12 skipped (opt-in suites), 0 failures. `tsc --noEmit` exit 0 for backend (src and test), worker, frontend, shared-utils; `git diff --check` exit 0.

Limitations:
- Fixed windows (calendar minute / UTC day): a burst straddling a boundary can use up to twice a limit across the edge.
- Per-tenant overrides via env need a restart.
- The eval-run "one active run" check is best effort (read then reserve); the runs/day cap is the hard bound.
- A unit already taken is not refunded if the request fails before the provider call.
- Redis is now a hard dependency of the test tools; an outage disables them (by design).
- Deploying needs backend and frontend rebuilt and Redis reachable.

#### 5.4.1 Release-readiness check (local, disposable Postgres and Redis, no provider key, nothing contacted)

Startup (the real compiled `dist/main.js`, then an `AppModule` context):
- Boots and answers `/api/v1/health`; SIGTERM exits in about 1 s. The app does not call `enableShutdownHooks` (existing behaviour), so modules are not destroyed gracefully on SIGTERM; not changed here.
- Startup needs `STRIPE_SECRET_KEY` (existing `StripeGateway` constructor) and a base64 32-byte `CREDENTIALS_ENCRYPTION_KEY`; a hex key only logs an error. Neither is D12.
- `SimulationLimitsService` is one singleton and is the instance injected into `AiTestChatService`, `CommerceTestChatService`, `EvaluationRunService`, `AiLogsController` and the `@Optional()` parameter of `AiLearningTriggerService` (the one that would silently run uncapped if unwired). `usage()` works through the app's own Redis-backed store; `app.close()` completes.
- Config loading: an env value above its ceiling, a tenant override above the ceiling, negative, float, `1e9`, non-numeric, empty, malformed JSON, a non-object, and `__proto__`/`constructor` keys are all ignored (defaults stand, warning names only the setting). A tenant override of 0 switches that scope off.
- The earlier timeout was a test-harness cost (ts-jest compiling the whole app), not an application fault; the compiled app boots in seconds.

Defect found and fixed: with Redis unreachable a send hung instead of returning 503 (BullMQ's connection retries forever and queues commands). It still failed closed (no provider call) but never answered. Every store operation is now bounded to 2 s and then becomes 503 `SIMULATION_LIMITS_UNAVAILABLE`. A command that times out may still execute when Redis returns; that can only over-count, never admit an extra request.

Defect found and fixed: usage reported `0` tokens and `$0` cost when calls had no provider-reported tokens. Token totals and `estimatedCostUsd` are now `null` ("unknown") when there were calls but none reported or could be priced; 0 means only "no calls" or a reported zero; `callsWithoutTokenCounts` and `costEstimateComplete` remain, and `costBasis` states the cost is a catalog estimate, not a provider charge.

Real HTTP checks against the running app (17/17, throwaway script, seeded rows removed afterwards): usage shows only the caller's tenant (1 call, not the other tenant's 3 calls or token totals); `?tenantId=` and `X-Tenant-ID` do not switch tenant; a token for tenant A's user forged with tenant B is 401; an AGENT is 403 even with a token claiming ADMIN; no secret-named fields in the response; oversized input 400 `SIMULATION_INPUT_TOO_LONG`; spent allowance 429 with scope and retry time; Redis down 503; dev tools off 403; no `AiExecution` row is created by any refused request. Duplicate, failed-provider and concurrent cases are covered by the real-Redis spec (100 requests against a budget of 10 run the work exactly 10 times; 20 simultaneous retries of one id run it once) and the service specs (a failed attempt's retry is not re-run and a timeout is remembered). They were not re-driven through HTTP because that would reach the provider path.

Frontend (headless Chrome driving the real page via the DevTools protocol, against the local backend; no provider reachable): normal state shows "0 of 7 test messages used today" with `maxLength` 1000; spent state shows a red `role=alert` line, input and button disabled; store-down state keeps the page usable, a refused send shows "The test tools are temporarily unavailable. Nothing was sent. Please try again shortly." Two UI defects fixed: a refused message stayed in the thread as if sent and its text was lost (now removed and restored to the input), and the input stayed enabled once the allowance was spent. Not covered: a successful reply render (needs a provider), mobile widths, and the cost estimate is not shown on the page (it is in the usage endpoint). The page is only reachable with `NEXT_PUBLIC_SHOW_DEV_TOOLS=true`, as on staging.

Results: full backend suite 159 suites passed and 1 failed, 2388 tests passed; the one failure was `audio.util.spec.ts` (real ffmpeg, unrelated, known flaky), which passes 3/3 alone. Opt-in real Redis 16/16, real Postgres 11/11; `tsc --noEmit` exit 0 for backend (src and test), worker, frontend, shared-utils; `git diff --check` exit 0.

## 6. Tests run (this branch)

| Command (from `apps/backend`) | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx jest src/messages/messages.service.spec.ts` | 92 passed |
| mutation script (7 mutants), `messages.service.ts` | 7/7 caught, restored |
| ad-hoc Postgres query check (disposable DB) | 8/8 correct |
| `npx jest` (full backend) | see "Full-suite result" below |
| `npx tsc --noEmit` in `apps/backend` (src and test), `apps/worker`, `apps/frontend`; `tsc` in `packages/shared-utils` | all exit 0 |
| `test/ai-test-chat-simulation.e2e-spec.ts` against the disposable PostgreSQL | 7/7 passed (skipped, not failed, without `AI_LEARNING_PG_TESTS=1`) |

Full-suite result: 150 suites passed, 1 skipped; 2062 tests passed, 12 skipped; 0 failures (`env -u DATABASE_URL npx jest`, no database, no provider). The 12 skips are existing opt-in suites (live provider and Postgres tests); they are not counted as passed. `git diff --check` exit 0.

Full-suite result after 5.2: 151 suites passed, 1 skipped; 2117 tests passed, 12 skipped; 0 failures (`env -u DATABASE_URL npx jest`). The skips are the existing opt-in live-provider and Postgres suites, not counted as passed. `tsc --noEmit` exit 0, `git diff --check` exit 0.

Full-suite result after 5.3: 153 suites passed, 1 skipped; 2218 tests passed, 12 skipped; 0 failures (`env -u DATABASE_URL -u AI_LEARNING_PG_TESTS npx jest`). The skips are the existing opt-in suites, not counted as passed. `tsc --noEmit` exit 0 for backend (src and test projects), worker, frontend and shared-utils; `git diff --check` exit 0; no secret-shaped strings in the added lines.

Full-suite result after 5.4: 160 suites passed, 1 skipped; 2376 tests passed, 12 skipped; 0 failures (`env -u DATABASE_URL -u AI_LEARNING_PG_TESTS -u AI_LIMITS_REDIS_TESTS npx jest`). Opt-in: real Redis 16/16, real Postgres 11/11.

## 7. Staging observations (Phase 9, partial)

- Running image contains the `ai-learning` changes (compiled output checked in the container). Production containers untouched.
- `grep -c AiInteractionEvalProcessor` on the logs returned 0: that is expected, Nest does not log processor registration; the check was
  invalid, not the deployment. A positive check needs a processed job (blocked by D2) or a Redis-side queue inspection.
- MinIO: fixed (see D9). Redis warning: benign configuration mismatch (D8).
- Every responder call currently fails with HTTP 401 (D2). Until a valid key is installed no end-to-end AI behaviour can be
  verified on staging, including the `ai-learning` smoke test. After fixing: recreate the backend (`--force-recreate`, a plain
  restart does not re-read the env file), confirm with a free `GET /models` check, then run the smoke test.

## 8. Blockers and authorization needed

1. Valid staging `DEEPSEEK_API_KEY` (owner action; never paste into logs or chat).
2. Permission to push `feature/ai-phase-completion` and open a PR to `staging` (not yet given for this branch).
3. Permission for any further staging deploy (manual, owner-run commands as before).
4. Decision on whether to bring the local-only `ai-eval` branch onto this line of work (it holds the evaluation engine pieces
   Phase 3 builds on).

## 9. Next actions (resume here)

1. Staging: deploy this branch (owner action: rebuild backend, worker and frontend) with a valid key and the `ai_learning_system` flag on
   one tenant, then confirm in the browser that Test Chat shows simulated replies and that a legacy reply produces an evaluation row.
2. D12 follow-up: review the proposed defaults (5.4), decide how per-tenant limits should be stored (env JSON now; admin UI needs a migration), and whether to badge/exclude the test conversation in the Inbox
   and analytics. Decide the `Message.status` `SIMULATED` enum value (migration) vs the current marker.
3. D4: judge input length caps, untrusted-content delimiting, and a per-tenant daily judge-call cap; usage accounting.
4. Bring the `ai-eval` commits onto this branch (cherry-pick) and extend them with the naturalness rubric and the
   baseline-vs-candidate gate for Phase 3.
5. D11: the hardcoded-wording audit (legacy prompt fallback line and name rule, shared fallback texts) with preservation tests.
6. Design the learning-candidate / verification / version / rollback model (needs a reviewed migration; explain risks first).
7. Trace knowledge-base ingestion (Phase 5) before claiming SSRF coverage.
