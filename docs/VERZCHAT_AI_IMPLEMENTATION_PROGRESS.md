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
| D11 | Fixed wording remains in the legacy prompt (`"That's a great question! Our team will follow up with you shortly."`, `"Address the customer by name"`) and in the shared fallback texts. The Phase 2 hardcoded-response audit is not done. | Medium | `VERIFIED` (code and prompts), see 5.5; live-model effect not measured |
| D4 | `ai-learning` judge: no spend cap or usage accounting, no input redaction or length caps, no prompt-injection delimiting, `max_tokens: 500` under an unverified thinking default | Medium | `PARTLY DONE`, see 5.7: input caps, untrusted-input rule and usage logging done; real-traffic spend cap, durable usage record, redaction and the `max_tokens` check remain |
| D5 | Review-task uniqueness is serialization-enforced, not a DB constraint (`InternalTask` has none) | Low | accepted limitation, documented |
| D6 | `runExclusiveForConversation` and the client-send dedupe are per-process; a second backend replica would break their guarantees | Medium (latent) | `NOT_STARTED` |
| D7 | No learning-candidate pipeline, verification gate, versioned activation or rollback | Missing feature | `NOT_STARTED` |
| D8 | Staging Redis runs without `requirepass` while clients send `REDIS_PASSWORD`: harmless "does not require a password" warning, Redis not published outside the compose network | Low | `NOT_STARTED` (needs staging infra change, owner approval) |
| D9 | Staging MinIO rejected the backend key (volume created with an older key) | Was blocking uploads | fixed on staging by recreating MinIO (owner action), verified: error gone |

## 4. Phases and acceptance status

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit the existing system | `IN_PROGRESS`: reply path, takeover, queues, models, frontend inventoried; knowledge ingestion, credits, retention not yet traced |
| 1 | Reliable AI foundation (provider abstraction, validation, retries, instrumentation) | `IN_PROGRESS`: D1, D3, D10, D11 and D12 done; D4, D6 open |
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

### 5.5 D11: hardcoded response wording  (`IMPLEMENTED` + `VERIFIED` locally; live-model effect not measured)

Audit (which execution path each wording problem actually reaches):

| Item | Where | Reaches a customer? | Class | D11 action |
|---|---|---|---|---|
| `"That's a great question! Our team will follow up with you shortly."` | legacy prompt (`ai-responder.service.ts`); v2 seed template 1.0.0 and 1.1.0 (`responder-system.v1.ts`) | Legacy: yes, sent as written, nothing arranges a follow-up. v2: the phrase only capped confidence to 40, escalation needs 20 or below, so it was also sent unbacked | Unnecessary fixed wording and an unsupported promise | Removed from both. Replaced by instructions (clarify, partial answer, say plainly, point to a real route); not by another phrase |
| "Address the customer by name if provided" | same two prompts; the name is passed as `Customer name:` each turn | Yes, every reply | Unnecessary forced name | Replaced by a use-naturally rule; the name is still passed as data |
| "Keep replies short (1-3 sentences)" | same, plus shared style rules | Yes | Useful default that cut real answers short | "Usually 1-3 sentences but include everything needed" |
| Commerce: "say a team member will help with that" for refunds/discounts | `commerce-ai.service.ts` | Yes | Unsupported promise (no tool, no handoff) | Now: say you can't, use `create_internal_task`, promise only if it succeeded |
| Commerce: "you'll follow up once approved" (`AWAITING_APPROVAL`) | same | Yes | Backed by the real approval queue | Kept; the guard recognises it as backed |
| `FALLBACK_SIGNALS` confidence cap (legacy and v2 policy stage) | both | Internal | Control, matches the old canned text | Kept for tenants on a customised or older prompt |
| `HUMAN_HANDOFF_REPLY`, `MAX_ITERATIONS_FALLBACK_TEXT`, `PROVIDER_FAILURE_FALLBACK_TEXT`, `HANDOFF_FAILED_TEXT` | `escalation-messages.util.ts` | Yes | Reusable templates, each tied to a real handoff or an honest failure | Kept; `HUMAN_HANDOFF_REPLY` lost "right away" (a timing promise nothing guarantees) |
| Injection refusal line | all prompts | Yes | Security control | Untouched |
| Identity and safety block, grounding ("use only the knowledge base"), JSON output contract, business-hours and conversation-state blocks | prompts | n/a | Business policy, security | Untouched, asserted by tests |
| Pricing, stock, payment status, delivery check, refunds | commerce tools and rules | n/a | Deterministic logic | Untouched, asserted by tests |
| Escalation and credit metering, tenant isolation | `messages.service`, pipeline, credits | n/a | Authorization, billing, escalation | Untouched |

Changes:
- New `ai-core/prompts/response-rules.ts` holds the shared wording rules (answer first with no filler, knowledge-gap behaviour, conversation continuity, customer language, natural name use, reply length), used by both the legacy prompt and the v2 template so they cannot drift.
- New deterministic guard `ai-core/pipeline/follow-up-promise.util.ts`: a reply that promises a team follow-up is replaced by the real handoff (`shouldEscalate`, `HUMAN_HANDOFF_REPLY`) unless a tool arranged it this turn (`create_internal_task` returned a task id, or `submit_order_for_payment` returned `AWAITING_APPROVAL`; an errored tool never counts). Applied in the v2 policy stage and, for legacy and commerce, in `MessagesService.generateAiReply`. In a simulated (Test Chat) run no real handoff is requested and no provider is reached. Trace flag `unsupportedFollowUpPromise` (shared type extended).
- v2 template is now version 1.2.0. An existing install whose ACTIVE version is 1.1.0 receives 1.2.0 as a DRAFT only (the existing upgrade rule only auto-activates an untouched 1.0.0), so deploying does not change a live prompt. Activating it is a deliberate step via the existing `POST /prompts/:templateId/versions/:versionId/activate`. Legacy and commerce prompt changes are in code and take effect on deploy.
- `ai-core/quality/reply-wording.util.ts`: mechanical checker (filler opening, name in consecutive replies, repeated greeting, repeated apology, unsupported promise) for fixtures and later live evaluations.

Before and after (prompt text and guard behaviour; not live model output):
- Legacy, unanswerable question. Before: instructed to reply exactly "That's a great question! Our team will follow up with you shortly." After: told to answer what the knowledge covers, ask for the one missing detail, or say plainly it does not have it and that the customer can ask for a team member; and never to say the team will follow up. If it does anyway, the customer gets the handoff reply and the conversation is really handed off.
- Name. Before: "Address the customer by name if provided" on every turn. After: use it where natural, never guess, skip handles/numbers/emoji.
- Commerce discount request. Before: "say a team member will help with that". After: say it cannot be done here and create an internal task; mention follow-up only if the task succeeded.

Evidence (all local, no provider key, no network):
- Prompt-content tests (legacy prompt captured from the real service with axios mocked; v2 template rendered with the shared blocks; commerce system prompt captured): retired wording absent, new rules present once, every business and security rule still present (grounding, no invented prices, no refunds or payments, injection refusal, JSON contract, identity).
- Guard: 39 detector and trace cases (follow-up-promise spec), 8 new policy-stage cases (19 in that spec), 7 new `MessagesService` cases (legacy, commerce backed/unbacked/errored/approval, end-to-end auto-reply with a real handoff request, simulated run with no handoff and no provider call). One real gap was found by these tests and fixed ("A team member will get back to you" had no determiner match).
- Wording fixtures: 8 retired-style replies are flagged, 10 intended-style replies are clean (21 tests with edge cases). These are hand-written, not model output.
- Existing suites unchanged and green: pipeline, v2, commerce, legacy history, AI Learning trigger and processors, Test Chat isolation, quality scenarios. Prompts spec: version-bump and DRAFT-not-ACTIVE behaviour covered.
- Full backend suite: 163 suites passed, 1 skipped; 2482 tests passed, 12 skipped, 0 failed (the FFmpeg `audio.util.spec.ts` did not fail this run). `tsc --noEmit` exit 0 for backend (src and test), worker, frontend, shared-utils, shared-types; `git diff --check` exit 0. Opt-in: real Postgres Test Chat 11/11 and AI Learning concurrency 10/10 (after re-applying migrations to the restarted disposable DB), real Redis 16/16.

Limitations and remaining concerns:
- Not shown: that live model replies are more natural. No provider call was made (by design), so this change is verified as instructions plus deterministic guards, not as measured quality. The wording checker finds mechanical problems only.
- The promise detector is English only. A promise in another language, or an unusual phrasing, is not caught and relies on the prompt rule.
- The fixed reply texts (`HUMAN_HANDOFF_REPLY` and the others) are English whatever language the customer wrote in. Making them adapt would need a model call or per-language text; not done.
- v2 1.2.0 sits as a DRAFT on existing installs; until someone activates it, v2 keeps the 1.1.0 text (including the canned line), though the guard already covers its follow-up promise.
- A tenant who customised the prompt or wrote their own instructions with the old phrase keeps that wording; only the guard applies to them.
- The guard can convert an honest "the team will look into it" that a model writes unprompted into a real handoff; that is intended, but it will raise handoff volume slightly for tenants whose bots lean on that phrasing. Watch handoff counts after activation.
- Not audited: the chatbot-flow text and welcome messages tenants write themselves, the Messenger/Instagram-specific texts, and campaign/template wording (deterministic or tenant-authored by design).
- The `Customer name:` prefix is still added to the user turn each time; the model decides whether to use it.

### 5.6 Staging deployment of D10-D12 and the MinIO repair  (2026-10-29)

Deployment (owner-run on the staging VPS with `infra/scripts/staging-release-deploy.sh`, from a separate checkout at the exact commit):
- Candidate `f6b6728` (six commits, no migrations). The named extra-migration exception `20260708120000_verz_ai_grounded_retrieval` was justified by comparing the applied history with the commit: it was the only applied migration absent from the candidate, all 92 candidate checksums matched, none pending, none unfinished.
- Result per the script's output: images built, isolated restore rehearsal passed, `No pending migrations to apply`, five services recreated, nginx and ingress health passed. Independent checks afterwards: all five services running with 0 restarts and tagged `f6b6728`, health 200, unauthenticated usage endpoint 401, no dependency-injection errors, `SimulationLimitsModule` initialised. The v2 prompt stayed `1.1.0 ACTIVE`; 1.2.0 is created only as an inactive draft on the first v2 prompt build and was not activated.
- Rollback tag from that release: `rollback-20261029-165349` (code only).
- Not verified on staging: the follow-up guard, the new wording, commerce task creation and the usage limits against a live model, and an authenticated call to `GET /ai/test-chat/usage`.

MinIO (D9 recurred; not caused by this release, whose diff touches no storage code):
- Backend logged `MinIO init failed: The Access Key Id you provided does not exist`. The backend held `.env.staging`'s key; `wa_staging_minio` had been created on 2026-10-28 with MinIO's built-in default login (`minioadmin`), from a different env file (`/root/whatsapp-platform/.env.staging`) and a third checkout (`/root/verzchat-staging`). The release script does not recreate MinIO, so the mismatch only became visible when the backend was recreated.
- Repair (owner-run): volume backed up (7.3 GB, archive verified), then only `wa_staging_minio` recreated from `infra/.env.staging`. Verified: root user equals the backend key and is no longer the default; `bucketExists` returned true with the backend's own credentials.
- Hardening: staging MinIO no longer publishes host ports 9002/9003 (`027aa85`; they listened on 0.0.0.0 and [::], and Docker-published ports bypass UFW). Verified on the host: `docker port` empty, nothing listening, backend access still works, health 200. Production MinIO had the same publication; fixed separately by hotfix PR #137 (`9440d6f`, merged to `main` as `10859b1`). **That merge changes nothing on the running production container**: it applies only when `wa_minio` is recreated.
- Finding: the staging release moved the application from `/root/whatsapp-platform/.env.staging` to `infra/.env.staging`. The two files differ in `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PLATFORM_ADMIN_SETUP_SECRET`, `PAYSTACK_SECRET_KEY`, `MESSENGER_WEBHOOK_VERIFY_TOKEN` and the MinIO pair (names only compared). Expect staging logins to need redoing, and check Messenger and Paystack on staging if used.
- Finding: the staging DeepSeek key is identical to production's, so any live-model test on staging bills production. **Owner decision (2026-10-29): staging keeps using the same key.** This is recorded, not hidden: the staging preflight reports it as a warning when run with `--allow-shared-model-key` and fails without that flag. Consequences to keep in mind: billing is shared, and the provider's rate limit is shared, so a staging evaluation can use up production's allowance and make production AI replies fail over to the provider-failure fallback and handoff. Any live evaluation therefore has to be small, bounded by the usage caps, run at a quiet time, and watched; it still needs a separate explicit go-ahead.

Open items from this work: production `wa_minio` still publishes 9000/9001 until recreated (prerequisites: confirm no external user of those ports; production checkout updated; `wa_minio` project label `verzchat-prod` and volume `infra_minio_data` confirmed); `dev` is about 100 commits behind `main`, so the hotfix was not opened against it (decision needed: cherry-pick PR or a `main` to `dev` sync); consolidate to one staging checkout and one env file; tighten `infra/.env` and `.env.bak-metaapp` permissions; remove the 7.3 GB MinIO backup when satisfied; give staging its own DeepSeek key before any live evaluation.

### 5.7 D4 (part): hardening of the AI Learning judge input  (`IMPLEMENTED` + `VERIFIED` locally, uncommitted to any shared branch)

Audit of `ai-interaction-evaluator.service.ts` (the paid judge) found: no limit on the size of the customer message, the AI reply or the six prior turns sent to the provider; the system prompt never told the judge that this text is data rather than instructions (the text was already JSON-encoded, so it could not break the payload structure); and the judge's provider-reported usage was not recorded anywhere.

Changes:
- New `judge-input.util.ts`: `buildJudgePayload` bounds and cleans what is sent. The customer message and AI reply are each capped at 3000 characters, each earlier turn at 600, and the whole serialized payload at 9000 (the oldest context is dropped first, the graded turn is never emptied). Control characters are stripped (tab and newline kept), cuts never split a surrogate pair, and a text cut is marked `[truncated]` with an `inputTruncated` flag so the judge does not penalize the agent for it. The limits are proposals sized above a normal WhatsApp exchange, not product requirements.
- System prompt: an `UNTRUSTED INPUT` rule says that customer and agent text is data to grade, never instructions, and explains the truncation markers. This is an instruction to the model, so its effect on a live model is not measured; the structural protection (the text stays inside JSON string values, the model's output is clamped and checked against the fixed taxonomy) is deterministic and tested.
- The judge's provider-reported token usage is logged per call (`Judge call used N input and M output tokens (provider-reported)`), or `reported no token usage`. No count or cost is estimated.
- No schema change, no new dependency, no change to retry, idempotency or the D12 simulated-judge cap.

Evidence (local, no provider call): 20 new tests (helper: caps, drop order, escape-heavy text, surrogate pairs, control characters, injection text staying inert, no mutation, tiny limits; evaluator: bounded request, prompt rule present with the grading rules and output contract intact, steering text only as a string value, a model that obeys an injected score is still clamped and taxonomy-checked, usage logged and never invented). Mutation check: removing the bounded payload, the untrusted-input rule, the payload cap, or making absent usage an estimate each made tests fail; the control-character mutant could not be run to a result in the harness, so that behaviour rests on the direct assertion only. Full backend suite 164 suites passed, 1 skipped; 2502 tests passed, 12 skipped, 0 failed (the FFmpeg test did not fail); `tsc --noEmit` exit 0 for backend (src and test), worker, frontend, shared-utils, shared-types; `git diff --check` exit 0. The opt-in Postgres and Redis specs were not re-run for this change (the processor and queue are untouched).

Remaining for D4, none done here:
- A durable record of judge usage and cost needs new columns (a reviewed migration; explain risks first). Today it is only in the logs.
- A spend cap for REAL traffic: the judge runs once per real AI reply for tenants with the flag on, bounded by traffic and idempotent per execution. A cap would silently drop evaluations, so it is a product decision.
- PII redaction before the text reaches the provider, and a check of `max_tokens: 500` against the real model's thinking behaviour (a live call).

### 5.8 Learning-data safety, the conversation export tool, and the staging preflight  (`IMPLEMENTED` + `VERIFIED` locally; nothing run on staging or production)

State audit (current, from Git): `8579822` through the D4 commit are on `feature/ai-phase-completion` and the local branches built on it. They are **not** in `dev`, `staging` or `main`; only the MinIO port hotfix reached `main` (PR #137) and `dev` (PR #138). The knowledge-base URL SSRF fix (`4693a57`) and the persisted learn throttle are already in `staging` and `main`.

Findings and what changed:
- **KB URL ingestion (SSRF): resolved, no change needed.** Fetching goes through `public-page-fetch.ts` (DNS pinned at connect time, every redirect hop revalidated, redirects followed by the function, private/loopback/link-local/metadata addresses refused) and is its only caller; it has its own tests.
- **Knowledge-base learning (`learnFromConversations`): authorised and throttled, but two real gaps, now fixed.** It is admin-only, behind a kill switch that is OFF by default (`KB_LEARNING_DISABLED` must be `false` to run), with an atomic once-per-window claim per tenant. It used only non-AI replies as answers (good), but it sent raw customer and agent text to the provider and stored what the model wrote as **active** articles, so generated text was sent back to the model as fact on every reply with no review. Now: text is redacted (including the contact's and agent's names) before the provider call, generated content is redacted, and learned articles are created **inactive** until an admin activates them. Whether any staging or production tenant has the switch on is not known from the repository.
- **Redaction utility** (`common/privacy/pii-redaction.util.ts`): e-mails, URLs, tokens and keys, Luhn-valid cards, Ghana Card ids, phone-like and long digit runs, supplied names; linear-time scanners and a hard input cap (a long near-match could otherwise make a regex backtrack). It is a safety net, not anonymisation.
- **Conversation export tool** (`ai-learning/dataset/`, `npm run dataset:export`): one tenant, a window of at most 92 days, at most 2000 conversations in total across resumes, read-only database transaction, a dry run that prints counts only and writes nothing, and a write that needs a written-approval reference, an out-dir outside any Git work tree and a persistent pseudonym key. Output is redacted, keyed-pseudonymous (no tenant id, conversation id, phone, name or absolute time), role-labelled (`customer`, `ai`, `human_agent`, `system`), with a deterministic 70/30 dev/held-out split, human-written turns as the only answer candidates and AI turns never ground truth, Test Chat and evaluation contacts excluded, and no outcome-based filtering. Resumable, de-duplicating, with a purge command. Handling rules, the read-only role SQL, retention and deletion are in `docs/AI_LEARNING_CONVERSATION_DATA.md`. Two defects found while testing and fixed: the printed report carried a raw conversation id through its resume cursor, and `--limit` bounded only each run.
- **Staging preflight** (`infra/scripts/staging-ai-preflight.sh`): one command for identity (stops if this is not staging), service health, 401 on the unauthenticated usage endpoint, no published MinIO ports, required settings present, whether the staging model key equals production's, the backend/MinIO key match, the prompt state, and a MinIO round trip that writes, reads back and removes one uniquely named temporary object.

Evidence (all local): 112 new backend tests (redaction 45, KB learning 7, dataset builder 19, exporter 27, CLI 9, source 5; two mutation runs showed the protections are asserted: four KB mutants and the earlier judge mutants were each caught), 30 shell tests for the preflight, and a new opt-in end-to-end spec against a real PostgreSQL (4/4: tenant scope, keyset paging, a write rejected inside the READ ONLY transaction, no rows changed). Full backend suite 170 suites passed, 1 skipped; 2614 tests passed, 12 skipped, 0 failed; `tsc --noEmit` exit 0 for backend (src and test), worker, frontend, shared-utils, shared-types; `git diff --check` exit 0; real Postgres 11/11 + 10/10 + 4/4 and real Redis 16/16.

Not done, and why:
- **No production conversation was read or exported.** That needs the written authorisation and the read-only role described in the data document; the tool refuses to write without them.
- **No live model evaluation.** It needs a staging-only provider key (the staging key is, per the last check, identical to production's), the explicit live confirmation and your authorisation. The mission's mention of an existing harness with a case cap refers to the evaluation framework that exists only on the local branch `feature/ai-eval-safety-hardening`; it is not on this line of work.
- **No candidate store.** Review, versioning, approval, rejection and deletion of learning candidates need new tables (a reviewed migration); until then nothing generates or promotes candidates automatically, and KB learning stops at "inactive".
- **The staging preflight and the MinIO round trip were not run against the VPS** (no access from here); the script's logic is tested with fake commands only. The same MinIO authentication check was run by hand earlier and passed.

### 5.9 First live baseline evaluation on staging (one run, 2026-10-29)

What ran: one Commerce Evaluation run on the staging deployment (`f6b6728` images, responder prompt 1.1.0, staging model key shared with production by the owner's decision), started from the staging app by an admin. It ran for `STAGE_VERZCHAT's Workspace`, the workspace that admin was signed in to, not the tenant the preparation script had selected. Production was monitored throughout: 0 provider errors and 0 provider-failure fallback messages since T0, 0 ERROR lines in the staging backend and worker logs.

Result as recorded by the harness: verdict FAIL; 33 scenarios, 11 passed, 2 failed, 20 skipped; 17 provider calls, all successful, 145,618 input and 3,337 output tokens (provider-reported; no cost computed); response-quality average 4.2; criteria passed: price_accuracy 2/2, payment_handling 2/2, product_accuracy 2/2, escalation_behaviour 2/4.

How to read it (this is NOT a clean baseline):
- **20 skipped because the workspace has no active products** (confirmed: 0 active; `Verz's Workspace` has 58, of which 11 out of stock and 46 unlimited). The scenarios that need a product skip; only the 13 product-free ones ran. The price, payment and product criteria were therefore exercised on very few cases.
- **`reasoning_delivery_location_flow` failed because of a harness defect**, not the AI: four scenarios carry the `escalation_behaviour` criterion but are "must not escalate" scenarios, and the scorer always demanded a handoff. Fixed in `b7ff441` (`expectsEscalation: false`). This run's own score was produced before that fix.
- **`identity_hate_chatting_with_ai` exposed a real inconsistency.** The AI replied "Fair enough. If you'd rather talk to a person, say the word and I'll get a colleague to reach out..." and called no tools. In the commerce path an explicit request for a person sets the handoff signal (a real handoff happens) but the model was never told, so it could offer a choice the system had already taken away. The legacy and v2 paths answer with the fixed handoff reply. Commerce now does too, with no model call.
- The effect of D11 on the commerce path is therefore not isolated by this run: its guard is not on the harness path (the harness calls the commerce AI directly), and only the prompt wording can have mattered.

Fixes made after the run (local, not deployed): the scorer fix, the catalogue check and signed-in-workspace notice in `staging-eval-baseline.sh`, the commerce handoff reply, and deterministic acceptance of the fixed handoff reply as a handoff in the scorer. To get a clean baseline: deploy those to staging, use `Verz's Workspace` (or any workspace with active, out-of-stock and unlimited products), sign in as its admin, and run once.

Second run, after deploying the fixes (staging at `fae4aa7f691246b44654ee3a60d19298461a43e5`, prompt 1.1.0 still active, run created 2026-10-29 21:43 UTC, again for `STAGE_VERZCHAT's Workspace` because that is the workspace the admin is signed in to; nothing was run for `Verz's Workspace`):
- Harness verdict PASS, critical failure false; 33 scenarios: 13 passed, 0 failed, 20 skipped (still no products in that workspace). Criteria: price_accuracy 2/2, payment_handling 2/2, product_accuracy 2/2, escalation_behaviour 4/4 (was 2/4), responseQualityAverage 4.6 (was 4.2).
- Provider usage: 15 calls, all successful, 141,694 input and 3,339 output (provider-reported; every call reported its counts; no cost computed. The first run made 17 calls; two fewer is consistent with explicit requests for a person no longer calling the model, but that is an inference.
- Live evidence for the commerce handoff change: for "I hate chatting with AI" the reply was exactly "I'm connecting you with a team member who can help with this." with no tool calls (the first run's reply offered a choice the system had already taken away).
- Production during the run: 0 provider errors, 0 provider-failure fallback messages; staging backend and worker logs: 0 ERROR lines.
- How to read it: the two earlier failures changed for known reasons (a scorer defect fixed, and the handoff reply made deterministic), not because the wording became better. The same 13 scenarios ran both times, but each is one run judged partly by the same model, so the 4.2 to 4.6 quality movement is within what judge variation could produce and is not evidence of more natural wording. Price, payment and product criteria were each checked on only 2 cases. A full baseline still needs a workspace with active, out-of-stock and unlimited-stock products and an admin signed in to it.
- Release: the first deploy attempt stopped at the isolated restore rehearsal with the writers stopped and nothing rolled out (cause not identified; the same rehearsal passed twice afterwards); service was restored by starting the three stopped containers and the second attempt completed. Rollback tag `rollback-20261029-223442`.

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

1. Staging: D10-D12 are deployed (5.6). Next: a separate staging DeepSeek key and the `ai_learning_system` flag on one tenant, then confirm in the browser that Test Chat shows simulated replies and that a legacy reply produces an evaluation row (a live-model step; needs authorization).
2. D12 follow-up: review the proposed defaults (5.4), decide how per-tenant limits should be stored (env JSON now; admin UI needs a migration), and whether to badge/exclude the test conversation in the Inbox
   and analytics. Decide the `Message.status` `SIMULATED` enum value (migration) vs the current marker.
3. D4 remainder (5.7): a durable judge usage record (needs a reviewed migration), a spend cap for real traffic (product decision), PII redaction, and verifying `max_tokens: 500` against a live model.
4. Bring the `ai-eval` commits onto this branch (cherry-pick) and extend them with the naturalness rubric and the
   baseline-vs-candidate gate for Phase 3.
5. D11 follow-up: run the wording checker over replies from a live evaluation once a valid provider key and authorization exist, and activate v2 prompt 1.2.0 on staging deliberately (5.5).
6. Design the learning-candidate / verification / version / rollback model (needs a reviewed migration; explain risks first).
7. Trace knowledge-base ingestion (Phase 5) before claiming SSRF coverage.
