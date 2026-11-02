# Digital Self learning: architecture inspection and extension design

Status: **read-only inspection and design. Nothing described as PROPOSED exists, and nothing was implemented, migrated or deployed.**
Inspected: 2026-11-02, branch `feature/ai-no-canned-replies`, HEAD `d5f93b9`, **working tree dirty** (187 uncommitted entries, preserved untouched; this report describes the code as it stands in that working tree, which includes uncommitted hybrid-RAG, payment, security and campaign work). No database, staging or production system was contacted and no customer data was read.

Labels used throughout: **VERIFIED** (confirmed in the code I read), **PARTIAL** (exists but incomplete), **MISSING** (not implemented), **PROPOSED** (recommended, not built). Paths are relative to `apps/backend/src` unless they start with `apps/` or `docs/`.
Limits of this inspection: I did not run the system; I did not check which feature flags are switched on for which workspace; I did not read the mobile Learning tab, the platform-admin screens or the evaluation scenario files in detail; and statements about what a flag does come from the code that reads it.

---

# UPDATE 2: DECISION CLOSURE AND PHASE 1 IMPLEMENTATION READINESS (preparation only; nothing implemented)

Approved for preparation: Phase 1 scope as defined in U1.8 (workspace settings, pause/resume, caps, separate cost ledger, provider abstraction, idempotent accounting, global budget controls, credit-isolation tests). No code, schema, migration, prompt, configuration or UI was changed in this pass; the existing evaluator, Learning tab, approved guidance, the three response paths, `AiAgent` and `TenantSettings` are preserved. Facts below marked **VERIFIED** were read in the code; **RECOMMENDED** is my proposal.

## U2.1 The ten decisions P1-P10 (exact questions from U1.10, quoted verbatim)

Each row keeps the original wording. One quoted question contains a statement that I later found to be wrong; it is quoted as written and annotated, not replaced.

### P1
- **Exact question:** "Pause semantics: stops evaluation and proposals only, with a separate "use approved guidance" switch, or also stops guidance injection"
- **Why it matters:** "Pause learning without disabling Digital Self" can mean "stop the machine that learns" or "stop everything learned from shaping replies". These differ in customer-visible effect.
- **Recommended default:** two switches: `paused` stops evaluation and proposal generation; `useApprovedGuidance` (default on) controls whether approved examples and, later, the active version shape replies. Pausing alone changes no customer reply.
- **If another option:** a single switch that also stops guidance makes a pause change live replies (possibly during an incident, when that is wanted but surprising otherwise). A single switch that never stops guidance leaves an admin unable to switch learned behaviour off without a platform operator (today only the global environment variable does that).
- **Approval:** product owner only.

### P2
- **Exact question:** "Retention: 90 days for learning-owned free text, 13 months for anonymised metrics and ledger"
- **Why it matters:** Sets how long customer-derived text (judge reasoning, feedback notes, unapproved example text) is kept, and how long cost and quality history is available.
- **Recommended default:** as asked; the free-text field list in U1.3; scores, categories, counts and ledger rows kept 13 months then aggregated.
- **If another option:** shorter free-text retention reduces privacy exposure but loses reviewer context for older proposals; longer raises exposure and deletion-request burden; shorter metrics retention weakens trend measurement (Phase 7) and cost audit.
- **Approval:** **privacy/legal review required** (periods are unapproved proposals); operator confirms the job schedule.

### P3
- **Exact question (as written):** "Fix the deletion gap (contact/conversation deletion leaves `AiInteractionLog` and `AiTrainingExample` text) as part of Phase 1 or immediately after"
- **Annotation (correction, same decision):** later verification showed `AiTrainingExample` is removed by cascade when its conversation is deleted, including an already-approved example (silently removing live guidance); it is `AiInteractionLog` text that survives. The decision to be made is unchanged: fix the deletion behaviour in Phase 1 or immediately after.
- **Why it matters:** a deletion request currently leaves customer message and AI reply text in `AiInteractionLog`, and silently drops approved guidance with no audit entry.
- **Recommended default:** immediately after Phase 1 and before wider rollout (it needs a small change in the contact/conversation delete path and a privacy decision on approved examples), not inside Phase 1, which is deliberately free of customer-affecting changes.
- **If another option:** inside Phase 1 widens the scope into the delete path (a customer-data behaviour change) and delays Phase 1; deferring past rollout leaves the gap open for every newly enabled workspace.
- **Approval:** **privacy reviewer** for the treatment of already-approved examples; product owner for timing.

### P4
- **Exact question:** "New workspaces: learning default off until the admin opts in (with provider-processing disclosure)"
- **Why it matters:** decides whether customer conversation text goes to a model provider for judging without an explicit workspace choice.
- **Recommended default:** yes, off until opt-in, with a plain disclosure (provider, what is sent, redaction, retention).
- **If another option:** default on speeds adoption and produces data sooner, but sends conversation text to a provider without explicit consent, which may conflict with privacy commitments and customer contracts.
- **Approval:** **legal/privacy** for the disclosure wording and consent model; product owner for the default.

### P5
- **Exact question:** "Who absorbs learning cost: platform with caps (recommended now), or per-plan allowance later"
- **Why it matters:** determines whether learning cost is a platform expense or a workspace entitlement, and whether limits are commercial or protective.
- **Recommended default:** platform absorbs now, with per-workspace and global caps; revisit when the ledger has real data. Learning cost is never deducted from customer AI credits.
- **If another option:** an allowance per plan needs plan/entitlement design (and subscription sales are currently off, so there is no plan structure to hang it on); charging credits is excluded by your instruction.
- **Approval:** **finance/product**; no legal approval.

### P6
- **Exact question:** "Agent rating role and replacing the 1-5 prompt (Phase 2)"
- **Why it matters:** decides who can give feedback that feeds learning and whether the existing post-send 1-5 star prompt (writing to `AiInteractionLog.feedbackRating`, read by nothing in learning) stays.
- **Recommended default:** agents rate and give a better reply; admins review and approve; the 1-5 prompt is replaced by the good/bad control (U1.7); old ratings kept for reporting only.
- **If another option:** admin-only rating starves the system of the people who see the replies; keeping both controls gives agents two overlapping prompts and splits the signal.
- **Approval:** product owner; no legal approval. Phase 2 item, not needed to start Phase 1.

### P7
- **Exact question:** "Per-reviewer feedback uniqueness (index change) vs keeping one row per evaluation with audit"
- **Why it matters:** `AiEvaluationFeedback.evaluationId` is unique today, so a second reviewer's rating overwrites the first.
- **Recommended default:** keep one row per evaluation and record each overwrite in `AiLearningAuditLog` with the previous state.
- **If another option:** per-reviewer rows preserve disagreement and enable agreement metrics, but need a unique-index change and a rule for which rating drives status; more schema and more review UI.
- **Approval:** product owner. Phase 2.

### P8
- **Exact question:** "Default sampling and caps for newly enabled workspaces"
- **Why it matters:** the evaluator makes one paid judge call per AI reply today; defaults decide the cost of enabling a busy workspace.
- **Recommended default:** 10% sampling plus always evaluate escalations, tool failures and agent-rated replies; a daily evaluation cap tuned after the first week of ledger data; a conservative initial cap until then.
- **If another option:** 100% evaluates everything (highest cost and strongest signal, risky for large workspaces); lower sampling reduces cost but weakens the evidence thresholds for proposals.
- **Approval:** product/finance; operator sets the numbers. No legal approval.

### P9
- **Exact question:** "Judge model/provider (currently DeepSeek via environment key)"
- **Why it matters:** the judge is the processor of redacted conversation text and the main variable cost.
- **Recommended default:** route through `ProviderRegistryService` and keep the same model initially, so cost and behaviour are comparable before and after the change.
- **If another option:** a different provider or model changes cost, quality and the data-processing relationship; it needs a catalogue entry and a new adapter (the registry currently registers only DeepSeek, VERIFIED).
- **Approval:** **privacy/legal** if the provider changes (data-processing terms); engineering/finance for model choice. Keeping DeepSeek needs no new approval beyond P4's disclosure.

### P10
- **Exact question:** "Whether global budget keys live in `PlatformSettings` (recommended, already administered) or in environment only"
- **Why it matters:** decides how the global kill switch and daily budget are changed in an incident.
- **Recommended default:** `PlatformSettings` (no deploy needed to change; audited via `updatedBy`) plus an environment kill switch as an independent last resort.
- **If another option:** environment-only means a redeploy or container restart to change a budget; a settings-only design has no independent emergency stop if the database is the problem.
- **Approval:** operator/platform owner; no legal approval.

**Approvals needed before Phase 1 starts (minimum):** P1, P2 (the periods, as a working default), P4, P5 and P9. P3, P6, P7, P8 and P10 can follow or take the recommended defaults without blocking the first implementation steps. Legal/privacy/operator confirmation is genuinely required for: P2 periods, P4 wording and consent, P3 approved-example treatment, and P9 if the provider changes.

## U2.2 Phase 1 implementation readiness

### Facts that shape the order (VERIFIED in this pass or the previous one)
| Fact | Consequence |
|---|---|
| `AiLearningModule` is **deliberately standalone** and does not import `AiCoreModule`; `AiCoreModule` imports `AiLearningModule` (one-directional, documented in the module's own comment) | The evaluator cannot import the module that provides `ProviderRegistryService` without creating a cycle |
| `ProviderRegistryService` depends only on `DeepSeekProvider` (its constructor takes nothing else) | A small new `AiProvidersModule` can export both and be imported by `AiCoreModule` **and** `AiLearningModule`; no cycle and no `forwardRef`. (Whether `DeepSeekProvider` needs `ConfigService` to be confirmed in step 1.) |
| The atomic counter store increments by exactly one per reservation and reports the first blocked counter (`SimulationStore.reserve(specs)`; Redis script or in-memory twin); the evaluation budget already uses it per tenant per UTC day | A daily **evaluation-count** cap reuses it directly. A **monetary** cap cannot be enforced atomically with it, so the monthly budget is a ledger-sum check with a safety margin (accepted and documented) |
| `AiExecution.estCostUsd` is filled from the pipeline trace; where the estimate is computed from the model catalogue was not located | Step 1 finds the estimator and reuses it; if it is private to the generation path, a small shared helper is extracted rather than duplicated |
| Trigger and processor already re-check a per-tenant flag, treat only 5xx/network errors as retryable, never overwrite a final evaluation, and enqueue with a stable job id | Phase 1 adds checks beside the flag checks, not new mechanisms |
| The evaluator tests mock `axios` today | They are rewritten to mock the provider; this is the largest existing-test change |

### Exact implementation order (not started)
| Step | Work | Existing files and models reused or extended | New models / fields | Tests |
|---|---|---|---|---|
| 0 | Start from the committed release candidate, on a new feature branch | `refs/prep/release-candidate` tip once the release commits exist (see release report UPDATE 5); starting earlier from `d5f93b9` would collide with uncommitted edits to `ai-core.module.ts` and `lib/api.ts` | none | none |
| 1 | Confirm the three open facts: `DeepSeekProvider` dependencies, location of the `estCostUsd` estimator, counter-store usage; write the module-graph test first | `ai-core/providers/*`, `ai-core/models/model-catalog.ts`, `ai-core/executions/ai-executions.service.ts`, `ai-core/simulation/simulation-store.ts` | none | new `ai-learning.module-graph.spec.ts` in the style of `ai-logs.module-graph.spec.ts` |
| 2 | Additive migration: `AiLearningSettings`, `AiLearningUsage` | `schema.prisma`; `Tenant` relations | **`AiLearningSettings`** (`tenantId` unique, `learningEnabled`, `evaluationEnabled`, `paused`, `pausedAt`, `pausedById`, `sampleRatePercent`, `dailyEvaluationCap`, `monthlyLearningBudgetUsd`, `useApprovedGuidance` default true, `activeVersionId` reserved nullable, `retentionDays` default 90 unused, timestamps); **`AiLearningUsage`** (`tenantId`, `kind`, `refType`, `refKey`, `provider`, `model`, `inputTokens`, `outputTokens`, `tokensReported`, `estCostUsd`, `outcome`, `createdAt`; unique `(tenantId, refType, refKey)`; index `(tenantId, createdAt)`) | migration applied to a disposable copy; `migrate diff` shows only these two tables |
| 3 | Provider module extraction: `AiProvidersModule` exports `ProviderRegistryService` and `DeepSeekProvider`; `AiCoreModule` and `AiLearningModule` import it | `ai-core/ai-core.module.ts`, `ai-learning/ai-learning.module.ts` | none | module-graph test; `app.boot.spec.ts` (resolves the whole graph); existing ai-core specs |
| 4 | Settings reader and writer service with a short cache; absent row means "behave as today"; fail-safe defaults | pattern of `FeatureFlagsService.isEnabledCached` | none | unit: defaults, cache invalidation on update, DB failure behaviour |
| 5 | Budget service: daily count reservation through the counter store, monthly ledger-sum check, global kill switch and global daily budget read from `PlatformSettings` | `SimulationLimitsService` pattern and store; `PlatformSettings` | two settings keys (`ai_learning.global_kill_switch`, `ai_learning.global_daily_budget_usd`) | unit + concurrency: N parallel callers against cap M yields exactly M reservations; counters unreachable means skip |
| 6 | Trigger enforcement: skip enqueue when disabled, paused or sampled out (deterministic hash of the execution id; escalations, tool failures and rated replies always evaluated); a failing settings read never throws and never delays | `ai-learning/ai-learning-trigger.service.ts` | none | extend `ai-learning-trigger.service.spec.ts`; latency/failure-injection test |
| 7 | Evaluator through the provider abstraction with usage returned; redaction of every judge text field | `ai-learning/ai-interaction-evaluator.service.ts` (`callJudge`), `judge-input.util.ts`, `common/privacy/pii-redaction.util.ts` | none | rewrite `ai-interaction-evaluator.service.spec.ts` (mock the provider, keep the retry classification cases); extend `judge-input.util.spec.ts` for redaction |
| 8 | Processor enforcement and accounting: re-check pause/caps before the paid call, reserve, write ledger row **with** the result in the same transaction path, attempt-keyed so retries and redelivery cannot double count; `SKIPPED_*` markers | `ai-learning/ai-interaction-eval.processor.ts` (`storeUnlessFinal`, `recordFailure`) | none | extend `ai-interaction-eval.processor.spec.ts`: duplicate delivery, retry, crash between call and write, cap reached, paused |
| 9 | Settings, pause/resume and usage endpoints with audit | `ai-learning/ai-learning.controller.ts` (ADMIN), `ai-learning.service.ts` (`audit()` helper), `AiLearningAuditLog` | new action strings | extend `ai-learning.service.spec.ts`; authorization tests (non-admin, wrong tenant) |
| 10 | Optional `useApprovedGuidance` gate (default on = unchanged output) | `ai-learning/corrections/approved-corrections.service.ts` | none | existing `approved-corrections.service.spec.ts` unchanged and passing; new case for the switch |
| 11 | Admin surface: Settings section and usage summary in the existing Learning tab | `apps/frontend/src/app/(dashboard)/ai/AiLearningTab.tsx`, `apps/frontend/src/lib/api.ts` | none | frontend `tsc`; no customer-facing screen changes |
| 12 | Isolation, credit-accounting, three-path and golden-prompt tests; database suite on a disposable Postgres | `tenant-isolation.db.spec.ts` pattern, `ai-core/quality` harness, `credit-governed-ai.spec.ts` | none | see U1.9; plus a static test that the learning services import neither `AiCreditsService` nor `AiMeteredProviderService` |

### Test suites affected
Rewritten: `ai-interaction-evaluator.service.spec.ts`. Extended: `ai-learning-trigger.service.spec.ts`, `ai-interaction-eval.processor.spec.ts`, `ai-learning.service.spec.ts`, `judge-input.util.spec.ts`, `approved-corrections.service.spec.ts` (one case). Must pass unchanged: `correction-loop.journey.spec.ts`, `correction-selection.util.spec.ts`, all `digital-self/*.spec.ts` including `digital-self.db.integration.spec.ts`, `hybrid-rag-and-digital-self.integration.spec.ts`, `credit-governed-ai.spec.ts`, `app.boot.spec.ts`, the quality-harness scenarios, simulation-limits specs. New: module-graph, settings, budget (concurrency), ledger idempotency, isolation (database), credit-unchanged, latency/failure-injection, static-import tests. Full backend Jest and the typechecks of backend, frontend and mobile run at the end.

### Migration dependencies
Two additive tables with foreign keys to `tenants`; no existing table altered, no backfill, no enum change in Phase 1. The migration timestamp must follow `20261030130000_digital_self_learning_exclusion` and everything the release candidate adds; applying it needs the release candidate's migration history (including the restored `20260708120000_...`) to be present, and production's history differs slightly from the repository (see the remediation report), so the standard preflight against a sanitised schema copy applies before any real environment. Order inside the release: it ships as its own migration in a later release than the candidate, never inside it.

### Rollback considerations
- **Code rollback (image-only):** safe. The new tables are additive; older code never reads them. Absent or ignored settings mean today's behaviour. No data in the credit tables is touched, so there is nothing to reverse there.
- **Behavioural off-switches, fastest first:** the global kill switch (environment, then `PlatformSettings`), a workspace `paused` or `evaluationEnabled=false`, and the existing `ai_learning_system` flag per workspace.
- **Provider routing:** rollback of the evaluator change is a code rollback; no dual code path is kept, to avoid two judges. If the registry path misbehaves, the global kill switch stops evaluation until the previous image is redeployed.
- **Schema rollback:** forward-only. The tables can be left in place unused, or dropped by a later reviewed migration; nothing depends on them in the older code.
- **Ledger data:** append-only; nothing to reconcile on rollback except that evaluation cost from the rolled-back window is not recorded (the old code only logged it).
- **Settings changes:** every change is audited with previous/new state, so a bad configuration is reversible by replaying the previous state.

### Phase 1 acceptance (unchanged from U1.8)
No settings row and the same flag give the same evaluations as today, now with each judge call recorded in the ledger; a paused workspace queues and pays for nothing while its AI replies, Digital Self style and approved guidance continue; caps stop paid calls and say why; credits, reservations and the rendered prompt are byte-identical; all existing tests pass.

## U2.3 Readiness statement
**Digital Self Learning Phase 1 is ready to begin on a separate feature branch**, with these conditions:
1. The branch is cut from the committed release candidate (step 0), not from the dirty worktree; until those commits exist, the first code step is blocked on the release work.
2. The minimum approvals are given: P1, P2 (as a working default), P4, P5 and P9. Everything else in Phase 1 can proceed with the recommended defaults.
3. Step 1 (three small technical confirmations and the module-graph test) is done before any production code.
4. The privacy/legal items (P2 periods, P4 wording, P3 treatment of approved examples) are tracked as external dependencies; none blocks the code in steps 0-10, but P4's disclosure text must exist before any workspace is enabled.
Nothing in this update has been implemented.

---

# UPDATE 1: CONSOLIDATED PRODUCT DECISIONS AND PHASE 1 PLAN

Planning only; nothing implemented or changed (code, schema, migrations, prompts, UI, configuration). Staging, production and customer data were not touched. The reports above remain the evidence base; this update adds only the facts needed to close specific decisions, and each is cited.

Convention: **VERIFIED** (confirmed in code, earlier or in this pass), **ADOPTED** (product default you instructed me to treat as the plan), **RECOMMENDED** (my proposal that needs your approval), **DECISION** (needs your approval), **EXTERNAL** (operator, legal or provider dependency).

## U1.1 Adopted product defaults (from your instructions)
1. Learning is isolated per workspace; nothing crosses workspaces.
2. Learning combines human feedback with asynchronous automated evaluation.
3. Every change that affects live Digital Self behaviour needs human approval.
4. Workspace administrators can pause learning without disabling the Digital Self (or the AI).
5. Customer messages are untrusted and cannot directly modify learning instructions.
6. Learning cannot modify payments, credits, permissions, security, tool access or handoff rules.
7. The existing Digital Self response paths stay functional (Commerce, Verz AI v2, legacy).
8. `AiAgent` and `TenantSettings` personality and instruction models are preserved and extended only where necessary.
9. The existing AI -> Learning tab is extended; no duplicate section is created. (This resolves D1 of section 13.3 in favour of AI -> Learning.)
10. No model fine-tuning, DPO or RLHF in the first implementation.

## U1.2 Facts added in this pass (VERIFIED)
| Fact | Evidence |
|---|---|
| The provider abstraction is `ProviderRegistryService.forModel(modelKey)` returning an `AiProvider` whose `complete()` returns `usage {inputTokens, outputTokens}`, `attemptsUsed`, `provider`, `model`, `latencyMs`; request type carries `modelKey`, `maxTokens`, `jsonMode`, `timeoutMs`, optional `apiKey` | `ai-core/providers/ai-provider.interface.ts` |
| `AiMeteredProviderService` meters (reserves, settles, releases credits) **only** for task types `RESPONDER` and `LEAD_SCORE`; every other type passes straight to `provider.complete()`. `AiTaskType` is `RESPONDER, SUMMARIZE, KB_LEARN, TEST, LEAD_SCORE` | `ai-core/completion/ai-metered-provider.service.ts`, `packages/shared-types/src/ai.ts` |
| `AiCompletionService.complete()` always writes an `AiExecution` row and goes through the metered provider; `AiExecutionsService.record()` has an option `meterCredits:false` for callers whose provider call is already charged | `ai-core/completion/ai-completion.service.ts`, `ai-core/executions/ai-executions.service.ts` |
| The evaluator ignores all of this: `callJudge` posts to `DEEPSEEK_API_URL` with `process.env.DEEPSEEK_API_KEY`, and reported usage goes only to a log line; `AiInteractionEvaluation` has no token or cost fields | `ai-learning/ai-interaction-evaluator.service.ts`, schema |
| An atomic, fail-closed counter store already exists for budgets: `SimulationLimitsService.reserveEvaluation()` reserves one unit with a limit and TTL per tenant per UTC day, and skips the evaluation if the budget is spent or the counters are unreachable | `ai-core/simulation/simulation-limits.service.ts` (~line 235) |
| A platform-wide key/value store exists: `PlatformSettings(key unique, value Json, updatedBy)` | schema `platform_settings` |
| A PII redaction utility exists: `redactText()` | `common/privacy/pii-redaction.util.ts`; already used on approved corrections |
| The judge payload is built by `buildJudgePayload()` from prior turns, customer message, AI reply and three backend-state fields; it is **not** persisted (only the judge's reasoning is) | `ai-learning/judge-input.util.ts` |
| AI messages are stored with `metadata { aiGenerated: true (+ commerce, security-refusal, simulated flags) }` and **carry no execution id or log id**. `AiInteractionEvaluation.messageId` is nullable and nothing in the resolver or processor sets it | `messages/messages.service.ts` (~2145), `ai-learning/*` |
| Learning-owned data and deletion: `AiInteractionEvaluation` cascades from `Tenant` and from `Conversation`; `AiEvaluationFeedback` cascades from the evaluation; `AiTrainingExample` cascades from `Tenant` and from its source evaluation (so it is removed when the conversation is deleted, **including an already-approved one**, which silently removes live guidance); `AiInteractionLog` (stores `customerMessage`, `aiResponse`; `conversationId` is a plain string) cascades from `Tenant` only. Deleting a contact (`contacts/contacts.service.ts remove`) deletes its conversations, messages, notes, call logs and campaign rows, which cascades to evaluations, feedback and training examples, but leaves `AiInteractionLog` rows. `DigitalSelfLearningEvent` stores features, not text | schema + `contacts.service.ts` |
| The agent-facing AI feedback control today is the post-send 1-5 prompt in `ChatWindow.tsx`, writing to `AiInteractionLog.feedbackRating` via `PATCH /ai-logs/:id/feedback` (tenant-scoped `updateMany`); the evaluation feedback endpoint is `@Roles(ADMIN)` | `ChatWindow.tsx`, `ai-logs.service.ts`, `ai-learning.controller.ts` |
| `submitFeedback` sets the evaluation to `APPROVED`/`REJECTED`, and the processor treats only `PENDING`/`FAILED` as writable, so an admin rating makes an evaluation final | `ai-learning.service.ts`, `ai-interaction-eval.processor.ts` |

Not inspected in this pass: whether `SimulationLimitsService`'s store supports weighted (non-unit) increments; where `AiExecution.estCostUsd` is computed from the model catalog; module-dependency details between `AiLearningModule` and `AiCoreModule`. Phase 1 step 1 confirms these.

## U1.3 Privacy and data handling (RECOMMENDED defaults; none is legally approved)

| Topic | Recommended default | Basis / note |
|---|---|---|
| Redaction before the evaluation provider | Pass every judge field (prior turns, customer message, AI reply, retrieval snippets) through `redactText()` before `buildJudgePayload()` serialises it; never send contact name, phone, email or address fields; keep the existing size caps | utility and caps exist (VERIFIED); accuracy trade-off (a redacted price or name can mask a real error) is measured in Phase 3 tests |
| Minimum context | Current turn, at most the last N earlier turns that already exist in the payload, bounded retrieval snippets (titles plus the first characters), sanitised tool trace; no whole-conversation export | payload caps exist (9,000 chars) |
| Transparency to workspace admins | Settings screen states: which provider processes evaluation text, that text is redacted first, what is kept and for how long, and shows learning usage; text maintained with whoever owns privacy documentation | EXTERNAL: the exact wording and the provider's terms need review |
| Cross-workspace learning | Not permitted. No shared example pool, embeddings or proposals; the shared model is a stateless processor | design, see section 9 |
| Retention of raw evaluation context | **Proposed 90 days**, subject to privacy/legal review. "Raw" = free-text fields learning owns: `AiInteractionEvaluation.evaluatorReasoning`, `AiEvaluationFeedback.notes` / `expectedAction` / `expectedResponse` on items that never became an approved example, the `customerInput`/`actualResponse` of examples that were never approved, and `AiInteractionLog` text used only for learning (see decision below). After 90 days these fields are nulled by a scheduled job; rows, scores and categories remain | DECISION: confirm the period and the field list |
| Longer-lived anonymised metrics | Keep scores, categories, severity, timestamps, counts and learning-usage ledger rows for 13 months (then aggregated per day/week), with no free text and no contact or conversation text | RECOMMENDED; period needs confirmation |
| Approved examples and active versions | Retained while approved (they are deliberate, curated guidance); each is redacted at use (VERIFIED) and shown with provenance to admins; an admin can withdraw any of them | existing behaviour |
| `AiInteractionLog` | This table also serves the suggestion workflow and analytics, so its retention is a separate, broader decision. Learning must not add a new copy of its text | DECISION |
| Deletion of a conversation or contact | **Two gaps today (see the facts table):** (a) `AiInteractionLog` customer and AI text survives a contact or conversation deletion; (b) deleting a conversation also deletes any approved training example derived from it through the cascade, so a deletion request silently removes live guidance without an audit entry. Recommended: on contact or conversation deletion, delete or null `AiInteractionLog` text by `conversationId`; for approved examples, make the cascade an explicit step that audits the removal and (where the privacy reviewer agrees) keeps the curated expected reply only after redaction, otherwise removes the example; keep non-identifying metrics; write an audit entry | needs a small code change in the delete path; **privacy reviewer must confirm** the treatment of approved examples |
| Deletion of a workspace | Everything cascades from `Tenant` (VERIFIED for evaluation, feedback, example, audit, log rows); new tables must follow the same rule; the usage ledger is deleted with the tenant unless finance requires retention | RECOMMENDED; finance/legal to confirm ledger retention |
| Workspace data export/erasure on request | Provide an export and an erase of learning data per workspace, tied to the existing data-deletion page | DECISION |
| Provider processing | Evaluation text goes to the model provider currently used (DeepSeek, via an environment key). Whether workspaces must opt in, and whether the provider's terms permit this processing, is not established here | **EXTERNAL: privacy counsel and the provider's data-processing terms.** RECOMMENDED: default off for a new workspace until enabled by its admin |

Genuine legal or operator confirmations (and no others): the 90-day and 13-month periods; consent/opt-in and transparency wording for provider processing; treatment of approved examples on a deletion request; the provider's data-processing terms.

## U1.4 Learning cost ledger and controls (RECOMMENDED design, built on what exists)

### Why not reuse the credit path or `AiExecution` rows
`AiMeteredProviderService` and `AiCompletionService` are the credit-bearing path. The metered check is by task type, so a new unmetered type would not charge credits, but `AiCompletionService` always records an `AiExecution` row (visible in AI activity and analytics), which would mix learning calls into customer-facing AI history. The recommended path calls the existing **provider abstraction directly** (`ProviderRegistryService.forModel()` -> `AiProvider.complete()`), and records the result in a **separate ledger**.

### Ledger: `AiLearningUsage` (new, append-only)
| Field | Meaning |
|---|---|
| `tenantId` | owner of the cost (FK `Tenant`, cascade) |
| `kind` | `EVALUATION` or `PROPOSAL` (later `EXPERIMENT`) |
| `refType`, `refKey` | e.g. `evaluation`, `<aiExecutionId>:<attempt>`; unique with `tenantId` so a redelivered job cannot insert the same call twice |
| `provider`, `model` | from the provider result |
| `inputTokens`, `outputTokens`, `tokensReported` | as the provider reported; `tokensReported=false` when it gave none (no estimate presented as fact; consistent with the evaluator's existing log message) |
| `estCostUsd` | computed with the same catalogue rates that fill `AiExecution.estCostUsd` (location confirmed in Phase 1 step 1); `NULL` when tokens were not reported |
| `outcome` | `OK`, `PROVIDER_ERROR`, `INVALID_OUTPUT`, `SKIPPED_CAP`, `SKIPPED_PAUSED` (skips cost nothing but are counted) |
| `createdAt` | index `(tenantId, createdAt)` |

Nothing in this ledger is ever written to `AiCreditTransaction`/`AiCreditReservation`, and the evaluator never imports `AiCreditsService` or `AiMeteredProviderService` (enforced by a static-import test).

### Idempotency and retries
- Existing guards stay: job id per execution, one evaluation per execution (unique `aiExecutionId`), a final evaluation is never re-judged, permanent failures are not retried, only 5xx/network errors are.
- The ledger key is `executionId:attemptNumber` (`job.attemptsMade`). Each real provider call is counted once; a redelivered job for the same attempt hits the unique key and counts nothing; a retry is a new attempt and is counted because it is a new paid call.
- The ledger row is written in the same transaction as the evaluation result (or the recorded failure), so a stored result never lacks its cost and a duplicate store never double-counts. If the process dies between the provider call and the write, that one call is under-counted; this is accepted and documented, preferable to charging twice.

### Limits and pause
- **Workspace caps:** `dailyEvaluationCap` and `monthlyLearningBudgetUsd` on `AiLearningSettings`. Daily count uses the existing atomic counter store pattern (reserve before the paid call, fail closed: counters unreachable means skip). Monthly spend is checked against the ledger sum for the calendar month with a small safety margin, because spend is only known after the call.
- **Global controls:** two `PlatformSettings` keys (RECOMMENDED names `ai_learning.global_kill_switch` and `ai_learning.global_daily_budget_usd`) read through the existing platform settings access, plus the existing environment kill-switch idea; a global limit reached pauses evaluation for everyone without touching the AI.
- **When a limit is hit:** the processor does not call the provider, writes a `SKIPPED_CAP` ledger marker (no cost), does not throw (no retry storm), and the workspace admin sees "evaluation paused: daily limit reached" with the reset time. Skipped executions are not back-filled (backfilling is itself cost).
- **Pause:** `AiLearningSettings.paused` (and `evaluationEnabled`) is checked in the trigger (so nothing is queued), and again in the processor (jobs queued before the pause are dropped without a paid call), exactly like the existing flag re-check.
- Sampling: `sampleRatePercent` applied in the trigger with a deterministic hash of the execution id; escalations, tool failures and agent-rated replies are always evaluated.

### Provider failure behaviour
Unknown model/provider or missing key = permanent failure (recorded `FAILED`, no retry, one ledger row only if a call was made). `AiProviderError` with a certain failure and `uncertainOutcome=false` = retry per classification; `uncertainOutcome=true` = counted as a call made. All learning calls have a hard `maxTokens` and `timeoutMs`. A provider outage never affects the customer reply (the evaluation is queued after the reply path completes, and queue failures are already swallowed and logged).

## U1.5 Smallest extension of the existing evaluation pipeline (no second evaluator)

| Need | Smallest change | Existing file or model reused |
|---|---|---|
| Workspace settings, enable/pause | New small `AiLearningSettings` table; a cached reader service with the same short TTL pattern as `FeatureFlagsService.isEnabledCached`; absent row means "behave as today" (flag-gated, no caps) | `ai-learning-trigger.service.ts`, `ai-interaction-eval.processor.ts` (add the checks) |
| Cost tracking | New `AiLearningUsage`; evaluator returns the provider's usage to the processor; processor writes ledger + result in one transaction | `ai-interaction-evaluator.service.ts` (return usage instead of only logging), processor's `storeUnlessFinal` |
| Per-workspace caps | Counter reservation before the paid call; ledger sum for the monthly budget | `SimulationLimitsService` pattern (reuse the counter store; confirm weighted increments if a monetary counter is wanted) |
| Route through provider abstraction | Replace the direct axios call in `callJudge` with `ProviderRegistryService.forModel(...).complete({ modelKey, jsonMode, maxTokens: 500, timeoutMs: 20_000 })`; keep the system prompt, validation and retry classification unchanged | `ai-core/providers/*`, `ai-core/models/model-catalog.ts` |
| Retrieved-knowledge evidence visible | Phase 3, not Phase 1: pass bounded retrieval snippets and the sanitised tool trace in `buildJudgePayload`, and expose the retrieval trace (already stored on the execution) in the admin interaction detail | `AiExecution.safetyFlags.retrieval`, `AiExecution.toolTrace`, `getInteraction()` |
| Safe retries and idempotency | Keep as is; add the attempt-keyed ledger | existing job id, unique evaluation, conditional writes |
| Asynchronous, no response delay | Unchanged: enqueue stays after `AiExecutionsService.record()`; the only added work on the reply path is one cached settings read inside the trigger's existing try/catch, and any failure there skips the enqueue without throwing | `AiExecutionsService.record()` |
| Redaction | Call `redactText()` inside `buildJudgePayload` | `common/privacy/pii-redaction.util.ts` |

## U1.6 Learning proposals and versions (RECOMMENDED definition)

### From findings to proposals
A scheduled per-workspace job (one job per workspace per period, deterministic id) works in two steps. **Step 1 is deterministic code:** group that workspace's evaluations by failure category and, where available, by the situation key used by the existing correction-selection similarity; require minimum support (for example at least 5 distinct conversations from at least 3 distinct customers inside the window, not counting replies already covered by an approved example); attach references. **Step 2 is optional and bounded:** one provider call phrases the proposed change in a fixed structure; its cost goes to the ledger and it respects the same caps. Nothing from step 2 can add evidence or alter the structure's fields.

### Required content of every proposal
| Field | Content |
|---|---|
| Workspace | `tenantId` |
| Weakness identified | category/pattern plus a plain-language statement; support count and rate (for example "12 of 140 evaluated replies, 8.6%") |
| Evidence and supporting examples | ids of evaluations, agent feedback and examples, with redacted excerpts shown to the reviewer; customer text appears only as quoted evidence |
| Proposed change | one typed item inside the allowlist (response-style preference, phrasing guidance, knowledge guidance note, do/don't), with the exact text that would be injected |
| Expected benefit | derived from the evidence by code (affected share of replies, severity mix); never a model-asserted promise; "unmeasured" until Phase 7 |
| Risk assessment | rule-based: LOW (style enum), MEDIUM (phrasing guidance), HIGH (knowledge guidance that could contradict the knowledge base or touches money/policy wording, or low support); flags for content that trips the injection screen or personal-data redaction (these are rejected automatically, never shown as approvable) |
| State | `PROPOSED`, `APPROVED`, `REJECTED`, `SUPERSEDED`, `EXPIRED`; `decidedById`, `decidedAt`, `decisionNote` |
| Dedupe | unique `(tenantId, dedupeKey)`; a rejected pattern is not re-proposed unless its evidence grows materially |

### Versions
- Approving one or more proposals produces a **new immutable `AiLearningVersion`** (version number per workspace, content hash, source proposal ids, creator, approver). The content is a full snapshot (previous active content plus the accepted items), validated against the allowlist schema, injection-screened and redacted.
- Activation is a single transaction: archive the current `ACTIVE`, set the new one `ACTIVE` and `AiLearningSettings.activeVersionId`, write the audit entry, invalidate the cache. Exactly one `ACTIVE` per workspace is enforced by a partial unique index.
- Rollback = activate an earlier approved version (recorded as a new activation, versions are never edited or deleted).
- The active version is per workspace and is the only learning layer read at reply time besides approved examples. No proposal, draft or archived version is ever read at reply time.
- Audit: `AiLearningAuditLog` actions for proposal created/approved/rejected/expired, version created/activated/rolled back, pause/resume, settings changed, with previous and new state.
- Each reply stamps `AiExecution.learningVersionId` (nullable column) so effects can be attributed and experiments run later.

## U1.7 Inbox feedback: smallest API and UI extension (RECOMMENDED)

### Current state (VERIFIED)
The inbox shows a 1-5 rating prompt after an agent sends an AI suggestion; it writes to a table that learning does not read. An AI message has `metadata.aiGenerated` but no execution id, so it cannot be tied to an evaluation. The learning feedback endpoint is admin-only and its submit sets the evaluation to final `APPROVED`/`REJECTED`.

### Smallest change
1. **Link:** write `aiExecutionId` (and the interaction log id when one exists) into the AI message's existing `metadata` JSON at the two AI-message creation sites in `messages.service.ts` (auto-reply, and suggestion-sent). No schema change. Older messages resolve by nearest earlier `AiExecution` in the same conversation (index exists), flagged "approximate".
2. **Endpoint:** `POST /ai-learning/messages/:messageId/feedback`, role AGENT or above, with the same conversation-visibility check the inbox already applies, tenant taken from the token. Body: `rating` (`GOOD`|`BAD`), `reasons[]` from `INACCURATE`, `IRRELEVANT`, `POORLY_PHRASED`, `UNHELPFUL`, optional `explanation`, optional `betterResponse`. Mapped onto the existing structures: reason keys in `AiEvaluationFeedback.reason`, text in `notes` and `expectedResponse`. If no evaluation exists for that execution, create a `MANUAL` one (the `evaluationSource` column and the unique `aiExecutionId` already allow this).
3. **Not automatically approved:** the agent endpoint writes feedback only. It does **not** use `submitFeedback`'s approve/reject status flip, does not create a training example, and does not touch guidance. A reviewed example still needs an admin to create it and approve it (existing flow). The evaluation stays writable so the automated evaluation can still run.
4. **Duplicates and audit:** one feedback row per evaluation exists today (unique `evaluationId`), so a second agent's rating overwrites the first; each submission is written to `AiLearningAuditLog` with the previous state. DECISION whether to change the uniqueness to per-reviewer (a unique-index change).
5. **UI:** on AI-generated messages in `ChatWindow.tsx`, a small good/bad control (the `ThumbsUp` icon is already imported) opening a compact popover with the four reasons, an optional explanation and an optional "better reply" field. It replaces the 1-5 prompt (DECISION D5); existing ratings are kept for reporting only.
6. **Isolation and abuse:** an agent can rate only messages of their own workspace's visible conversations; rate limiting on the endpoint; text is length-capped, injection-screened and redacted on read-out like every other learning text.

## U1.8 Phase 1 implementation-ready scope

Goal: make the existing evaluator controllable, attributable and capped, with **no customer-visible change** and no change to credits. Defaults reproduce today's behaviour.

### In scope
1. `AiLearningSettings` (new, 1:1 tenant): `learningEnabled`, `evaluationEnabled`, `paused` (+ by/at), `sampleRatePercent`, `dailyEvaluationCap`, `monthlyLearningBudgetUsd`, `useApprovedGuidance` (default true), `activeVersionId` reserved for Phase 6, `retentionDays` (default 90, unused until the retention job).
2. Pause/resume API and audit: `GET/PATCH /ai-learning/settings`, `POST /ai-learning/settings/pause` and `/resume` (ADMIN; tenant from the token).
3. Enforcement points: trigger (skip enqueue when disabled, paused or sampled out), processor (re-check before any paid call; cap reservation), and optionally `ApprovedCorrectionsService` (only if `useApprovedGuidance=false`; default keeps today's behaviour). Pausing never touches the Digital Self style layer or the AI.
4. `AiLearningUsage` ledger, per-workspace daily and monthly caps, global kill switch and daily budget via `PlatformSettings`.
5. Evaluator calls through `ProviderRegistryService` with usage returned and recorded; redaction of the judge payload; hard token and time limits.
6. Idempotent accounting (attempt-keyed unique rows, written with the result) and safe retries unchanged otherwise.
7. Admin surface limited to a **Settings** panel and a usage summary in the existing Learning tab (admin only).
8. Tests listed in U1.9.

### Out of scope for Phase 1
Customer-facing behaviour changes, inbox feedback (Phase 2), new dimensions or retrieval evidence (Phase 3), proposals (4), versions (6), retention job (later), any fine-tuning.

### Files and models reused or extended (VERIFIED to exist)
| Existing | Change |
|---|---|
| `ai-learning/ai-learning-trigger.service.ts` | read settings; skip when disabled, paused or sampled out; keep fail-safe try/catch |
| `ai-learning/ai-interaction-eval.processor.ts` | re-check pause and caps before the provider call; reserve; write ledger with the result in the existing `storeUnlessFinal` transaction path |
| `ai-learning/ai-interaction-evaluator.service.ts` | `callJudge` through `ProviderRegistryService`; return `usage`; keep prompt, validation, `TransientJudgeError` classification |
| `ai-learning/judge-input.util.ts` | apply `redactText` to every text field before serialising |
| `ai-learning/ai-learning.controller.ts`, `ai-learning.service.ts` | settings, pause/resume, usage endpoints; audit via the existing `audit()` helper |
| `ai-learning/ai-learning.module.ts` | register the new services; confirm the module graph with a test in the style of `ai-logs.module-graph.spec.ts` |
| `ai-core/simulation/simulation-limits.service.ts` and its store | reuse the atomic counter pattern (extend only if monetary increments are required) |
| `ai-core/providers/*`, `ai-core/models/model-catalog.ts` | consumed, not modified |
| `AiLearningAuditLog`, `PlatformSettings`, `Tenant` | reused; add action strings and two setting keys |
| `apps/frontend/.../ai/AiLearningTab.tsx` and `apps/frontend/src/lib/api.ts` | add a Settings section and usage summary using the existing tab, `StatCard` and form patterns |
| New | models `AiLearningSettings`, `AiLearningUsage`; services `learning-settings.service.ts`, `learning-budget.service.ts`; one additive migration |

Untouched (and asserted untouched by tests): `AiCreditsService`, `AiMeteredProviderService`, `AiCreditTransaction`/`AiCreditReservation`, `GenerationStage`, `PromptBuildStage`, `PolicyStage`, `EscalationStage`, tool registry, `DigitalSelfContextService`.

Phase 1 acceptance: with no settings row and the same flag, the evaluator behaves as today except that every judge call is now recorded in the ledger; pausing a workspace stops queuing and paid calls for it only; caps stop paid calls and are reported; credits, reservations and the rendered prompt are unchanged; all existing ai-learning, digital-self and pipeline tests pass.

## U1.9 Test requirements
Reuse existing suites unchanged (listed in section 11); add:

| Requirement | Test |
|---|---|
| Cross-workspace isolation | two real workspaces on a disposable Postgres (the `tenant-isolation.db.spec.ts` pattern): settings, ledger rows, caps, usage summary, pause of A never visible to or affecting B; mutation check by dropping a `tenantId` filter |
| Paused workspace | no job queued after pause; a job already queued is dropped with zero provider calls and a `SKIPPED_PAUSED` marker; resume restores; Digital Self style and the AI reply unchanged while paused; other workspaces unaffected |
| Global and workspace caps | N parallel jobs against a cap of M produce exactly M paid calls (atomic reservation); global kill switch and global budget stop all workspaces; monthly budget stops further calls; the admin-visible state says why |
| Retry and duplicate billing | same execution delivered twice, redelivery of the same attempt, retry after a 5xx, retry after a crash: one evaluation, ledger rows equal real provider calls, no duplicate key |
| Customer AI credits unchanged | `AiCreditTransaction`, `AiCreditReservation` and the credit balance are identical with learning on, paused and off for the same scripted traffic; a static test that the evaluator and settings services do not import `AiCreditsService` or `AiMeteredProviderService` |
| Provider failure | missing key, unknown model, 4xx, 5xx, timeout, malformed JSON: classified permanent or transient as before; no retry storm; failure recorded; customer reply unaffected |
| No latency regression on the customer path | the trigger returns without awaiting the processor; a deliberately slow or failing settings reader neither delays nor breaks `AiExecutionsService.record()` (timing assertion with a fake slow store, plus failure injection) |
| Existing three response paths | Commerce, v2 pipeline and legacy responder still build the same prompt and reply (golden prompt test over the existing quality harness) with learning enabled, paused and absent; `ApprovedCorrectionsService` output unchanged when `useApprovedGuidance` is true |
| Approved guidance and audit intact | existing `correction-loop.journey.spec.ts`, `approved-corrections.service.spec.ts`, audit-log writes for feedback and example status all still pass; new settings changes appear in the audit log with previous/new state |
| Redaction before the provider | the payload handed to the provider contains no email/phone/identifier patterns from a seeded conversation; sizes still within caps |
| Migration | additive migration applies to a copy of the current schema; `migrate diff` shows only the two new tables and their indexes |

## U1.10 Decisions still requiring your approval
| # | Decision | Recommendation |
|---|---|---|
| P1 | Pause semantics: stops evaluation and proposals only, with a separate "use approved guidance" switch, or also stops guidance injection | two switches, guidance on by default |
| P2 | Retention: 90 days for learning-owned free text, 13 months for anonymised metrics and ledger | confirm periods and the field list (also needs legal view) |
| P3 | Fix the deletion gap (contact/conversation deletion leaves `AiInteractionLog` and `AiTrainingExample` text) as part of Phase 1 or immediately after | immediately after Phase 1, before wider rollout (covers both the surviving `AiInteractionLog` text and the silent loss of approved examples); treatment of approved examples needs the privacy reviewer |
| P4 | New workspaces: learning default off until the admin opts in (with provider-processing disclosure) | yes |
| P5 | Who absorbs learning cost: platform with caps (recommended now), or per-plan allowance later | platform absorbs; revisit with ledger data |
| P6 | Agent rating role and replacing the 1-5 prompt (Phase 2) | agents rate, admins approve; replace the prompt |
| P7 | Per-reviewer feedback uniqueness (index change) vs keeping one row per evaluation with audit | keep one row, audit overwrites, for now |
| P8 | Default sampling and caps for newly enabled workspaces | 10% plus all escalations and tool failures; daily cap tuned from the first week of ledger data |
| P9 | Judge model/provider (currently DeepSeek via environment key) | route via the registry; keep the same model initially |
| P10 | Whether global budget keys live in `PlatformSettings` (recommended, already administered) or in environment only | `PlatformSettings` plus an environment kill switch |

## U1.11 External and operator dependencies
- **Privacy/legal counsel:** retention periods, opt-in and transparency wording for sending redacted conversation text to a model provider, deletion treatment of approved examples, the provider's data-processing terms.
- **Platform operator:** set the global kill switch and daily budget values; enable the `ai_learning_system` flag per workspace only after Phase 1 is deployed and tested.
- **Finance:** whether the usage ledger must be retained after a workspace is deleted, and the cost-allocation model.
- **Engineering follow-up inside Phase 1 step 1 (no external dependency):** confirm the counter store's increment semantics, the `estCostUsd` calculation location, and the module graph.
- Release dependency: this work builds on the uncommitted branch; it should start only after the release candidate commits exist, to avoid mixing it into the release (see the release report, UPDATE 4).

## U1.12 Next exact task and approvals
1. **Next exact task (after your approval of P1, P2, P4, P5 and the Phase 1 scope):** implement Phase 1 on a new feature branch cut from the committed release candidate, beginning with step 1 (confirm the three open technical facts), then the additive migration, settings service, trigger/processor enforcement, ledger and provider routing, then the tests in U1.9. Not started.
2. **Approvals needed from you:** the Phase 1 scope (U1.8), decisions P1-P10 (at minimum P1, P2, P4, P5, P9), and the sequencing decision that Phase 1 starts only after the release commits exist.
3. **Not needed to start Phase 1:** inbox feedback, proposals, versions, any fine-tuning work.


---

## 1. Executive summary

1. **A large part of what you asked for already exists, and it must be extended, not rebuilt.** VerzChat already has an asynchronous, queue-based evaluation of AI replies (`ai-learning/`), a human feedback and correction workflow, reviewed "training examples" that an admin approves, and an approved-guidance block that is injected into live prompts for every AI path. It has an audit log, a kill switch, and a dataset-export tool. (VERIFIED, section 3.)
2. **"Digital Self" in the code is something narrower than the learning goal.** It is a per-human-agent writing-style profile (counters learned from that agent's own replies; no message text stored), selected per conversation. It changes how a reply sounds only. The workspace-level personality and instructions live elsewhere (`AiAgent`, `TenantSettings`). So "make the workspace's Digital Self improve" is really two existing systems that must be joined by a new, versioned, workspace-level layer. (VERIFIED, sections 2 and 5.)
3. **The existing learning loop already has a safe injection point and it is used by all three response paths** (Commerce, Verz AI v2, legacy responder): `ApprovedCorrectionsService.getGuidanceBlock()`. The identity and safety block is appended by code after the prompt body, so guidance cannot override it. The recommended design adds a versioned guidance layer at that same seam. (VERIFIED, section 7.)
4. **The real gaps are governance and cost, not mechanics:**
   - No workspace-level learning settings, pause, sampling or spend cap (only platform feature flags, one global environment switch, and a per-agent Digital Self pause). **MISSING**
   - The judge's token usage is only written to a log line; it is not stored, not capped and not attributed to a workspace. The judge call bypasses the provider registry. **MISSING** (and there is no per-workspace daily cap for real, non-simulated evaluations)
   - No aggregation of recurring weaknesses into **proposals**. **MISSING**
   - No set-level **versioning, rollback or "active learning version"**; approval acts on individual examples. **MISSING**
   - Agents cannot rate AI replies in the inbox for auto-replies; the evaluation feedback API is admin-only, and the 1-5 inbox rating is stored on a different table that nothing reads. **PARTIAL**
   - The judge sees no retrieved knowledge and no tool results, so it cannot grade groundedness or retrieval quality, although the retrieval trace is already stored on each execution. **PARTIAL**
5. **Recommended first implementation phase: Foundation (settings, pause, cost ledger, caps), because the evaluator already exists and runs with none of these controls.** It adds no customer-visible behaviour and makes the next phases safe to build.

What already exists, what is missing, and the first phase are restated in section 14.

---

## 2. Verified existing Digital Self architecture

### 2.1 What the Digital Self is (VERIFIED)
- Model `DigitalSelf` (`apps/backend/prisma/schema.prisma`): one row per **user** (`userId @unique`), `tenantId`, `status`, `enabled`, `learningPaused`, `profile` (JSON), `profileVersion` (incremented on every learned message), `evidenceCount`, `lastLearnedAt`. Child `DigitalSelfLearningEvent` (`messageId @unique`) is the dedupe ledger.
- It learns **style features only** (length, emoji, formality, warmth counters; `digital-self/message-features.util.ts`, `profile.util.ts`) from a **human agent's own typed text replies**; it never stores message text, ignores AI replies, templates and saved replies, and reports no trait below 10 samples (`digital-self.constants.ts`: `MIN_ATTRIBUTE_SAMPLES=10`, `READY_SAMPLES=30`, `PROFILE_WINDOW=200`, `MAX_STYLE_BLOCK_CHARS=700`). Documented in `docs/ai-digital-self.md`; the code agrees with it.
- It is applied **per conversation** (`Conversation.digitalSelfId`, or the assigned human's own Digital Self) by `digital-self/digital-self-context.service.ts` `getStyleBlock()`, which returns `''` for any ineligible condition (flag off, disabled, inactive agent, AI-owned conversation, failed lookup).
- Gates: platform feature flag `digital_self` per tenant (`digital-self-learning.trigger.ts`, fail-closed); per-Digital-Self `enabled` and `learningPaused`; per-conversation `digitalSelfLearningExcluded` (removes evidence exactly).
- Admin controls (`digital-self/digital-self.controller.ts`): list/get (AGENT), assign to conversation (AGENT), exclude conversation from learning (AGENT), `PATCH :id/learning` pause, `PATCH :id/enabled`, `PUT :id/overrides` (style overrides), `POST :id/reset` (ADMIN). **VERIFIED**
- It is **not** a workspace-wide persona. **VERIFIED** (consequence for naming: section 9).

### 2.2 The workspace's identity, personality and instructions (VERIFIED)
- `AiAgent` (`name`, `personality`, `tone`, `systemInstructions`, `language`, `modelKey`, `maxResponseTokens`, `confidenceThreshold`, `allowedTools`, `knowledgeSourceIds`, `escalationRules`, `handoffSettings`, `memorySettings`, `safetyRules`, `workingHours`) and `TenantSettings` (`businessName`, business info, `aiEnabled`, `aiMode` SUGGESTION|AUTO_REPLY, `aiPersonality`, `aiAlwaysOn`, trial fields, `commerceEnabled`, `takeRatePct`...). These are plain mutable columns **with no version history**.
- Prompt template `responder.system` is **platform-level** and versioned (`AiPromptTemplate` key unique; `AiPromptVersion` DRAFT/ACTIVE/ARCHIVED; `prompts/prompts.service.ts` `activateVersion()` archives the old ACTIVE and activates the new one transactionally; only a platform SUPER_ADMIN can create/activate, `prompts/prompts.controller.ts`; an archived version cannot be re-activated, a new version must be created from its body). It is not workspace-specific.

### 2.3 Lifecycle, step by step (VERIFIED against the code)

| # | Step | Where it happens (exact code) |
|---|---|---|
| 1 | **Incoming customer message** | Channel webhooks (`whatsapp/whatsapp.webhook.controller.ts`, Messenger/Instagram, WhatsApp-web internal events) call `MessagesService.handleInbound*` (`messages/messages.service.ts`, `handleInbound` at ~1077) |
| 2 | **Workspace and channel identification** | Tenant resolved from the webhook route/phone-number owner; channel/number on the conversation (`conversationsService.findOrCreate(tenantId, contact.id, ...)`) |
| 3 | **Customer and conversation context** | `ContextAssemblyStage` (`ai-core/pipeline/stages/context-assembly.stage.ts`): tenant-scoped history (40 turns for a verified customer across their chats, 12 inside the conversation), `TenantSettings` business info, ad referral, advisory conversation state |
| 4 | **Business identity, personality, instructions** | `VerzAiPipelineService.run()` loads `AiAgent` (tenant-scoped) into the context (`personality`, `systemInstructions`, `modelKey`); `PromptBuildStage` renders the active platform template with `business_name`, `personality`, `tenant_instructions`, `knowledge_base`, `business_info`, `conversation_state`, then **appends in code** `SHARED_STYLE_RULES` and `buildIdentityAndSafetyBlock()` and the handoff block |
| 5 | **Knowledge retrieval and hybrid RAG** | `KNOWLEDGE_CONTEXT_SOURCE` token: `KbRelevantContextSource` (keyword) or `HybridKnowledgeContextSource` (keyword + vector, flag `RAG_HYBRID_ENABLED`; uncommitted work); both append the **approved-guidance block**. The retrieval trace is stored on the execution (`trace.safetyFlags.retrieval`). The Digital Self style block is appended after retrieval in the same variable |
| 6 | **Prompt construction and model selection** | `PromptBuildStage`; model = `AiAgent.modelKey` (default `deepseek-v4-flash`) resolved by `ProviderRegistryService.forModel()` in `GenerationStage` |
| 7 | **Response generation** | `GenerationStage`: with tools available it calls `ToolCallingService.complete()` (structured JSON `{response, confidence}`), otherwise `AiMeteredProviderService.complete()` |
| 8 | **Tool selection and execution** | `ai-core/tools/*` via `ToolRegistryService`; tool names from `resolveToolNames({ readOnlyTools })` (read-only in SUGGESTION mode); tool trace sanitised into `AiExecution.toolTrace` |
| 9 | **Validation and policy** | `GuardStage` (first: `detectInjection` blocks and writes no text; `SecurityRefusalService` writes the refusal in the workspace's voice), `PolicyStage` (channel formatting, fallback-signal confidence cap, unsupported follow-up promise becomes a real handoff, empty-output detection), `model-output.util.ts` (malformed/truncated/internal-error detection) |
| 10 | **Human handoff** | `EscalationStage` sets `shouldEscalate` on an explicit request or low confidence; `MessagesService.handOffBeforeReply` performs the real handoff before the reply is written (so the model is told the true outcome); `Conversation` status REQUESTED, SLA deadline |
| 11 | **Message delivery** | `handleAiAutoReply` sends via the channel service (WhatsApp/Messenger); `handleAiSuggestion` stores a suggestion (`AiInteractionLog` status SUGGESTED) and pushes it to agents through realtime; agent send via `MessagesService.sendMessage` |
| 12 | **Credits** | See 2.4 |

Dispatch (`messages.service.ts` `dispatchAiAndChatbot` ~1563): `aiMode` and per-contact eligibility decide AUTO_REPLY vs SUGGESTION; `generateAiReply` ~1760 picks Commerce (`CommerceAiService`, when commerce is enabled), v2 pipeline (flag `verz_ai_v2`) or the legacy `AiResponderService` (logged as scheduled to move to v2).

### 2.4 AI credit reservation, deduction, usage (VERIFIED)
- `AiMeteredProviderService.complete()` (`ai-core/completion/`): for task types `RESPONDER` and `LEAD_SCORE` only, it **reserves** (`AiCreditsService.reserveForProviderCall`) before the provider call, **settles** from provider-reported tokens (`settleReservationForUsage`) afterwards, and **releases** on a certain failure; an uncertain outcome keeps the reservation until it expires.
- `AiExecutionsService.record()` (`ai-core/executions/ai-executions.service.ts`) persists one `AiExecution` per call (provider, model, status, tokens, `estCostUsd`, `promptVersionId`, `safetyFlags` incl. retrieval, `stageTimings`, `toolTrace`), links reservations, settles or charges credits, and then **calls `aiLearningTrigger.maybeEnqueue()`** (the evaluation hook, fire-and-forget).
- Ledger models: `AiCreditTransaction`, `AiCreditReservation`, `AiPricingConfig`, `AiCreditPackage`. Legacy path: flat reservation (`reserveFixedCredits`).
- SUGGESTION mode requires sufficient balance before generating (`hasSufficientBalance`).

### 2.5 Queues and workers (VERIFIED)
`QueueName` (`packages/shared-types/src/queue-jobs.ts`): `AI_INTERACTION_EVAL` (`ai-interaction-eval`), `DIGITAL_SELF_LEARN` (`digital-self-learn`), `AI_EVAL_RUN`, `AI_TRIAL`, plus campaign queues. The evaluation and Digital-Self processors run **in the backend process** (NestJS DI), not in `apps/worker`.

### 2.6 UI components involved (VERIFIED)
- `apps/frontend/src/app/(dashboard)/ai/page.tsx`: tabs `kb`, `learned`, `analytics`, `activity`, **`learning`** (renders `AiLearningTab.tsx`, 332 lines: overview stat cards, interaction list, feedback form with expected action/reply). Mobile has `apps/mobile/src/components/ai/AiLearningTab.tsx` (not read in detail).
- Digital Self: `components/shared/DigitalSelfSection.tsx` (admins, inside the Team page `TeamManagement.tsx`), `DigitalSelfPicker.tsx` (conversation header in `inbox/ChatWindow.tsx` and `ai/test-chat/page.tsx`).
- Inbox rating: `ChatWindow.tsx` "Rate this AI suggestion" 1-5 stars after a suggestion is sent, calling `aiLogsApi.feedback` (`PATCH /ai-logs/:id/feedback`).
- AI Test Chat: `ai/test-chat/page.tsx` with simulation limits (`ai-core/simulation/`).

---

## 3. Existing feedback and evaluation capabilities

| Capability | Status | Evidence |
|---|---|---|
| Customer satisfaction ratings | **PARTIAL** | `Conversation.csatScore/csatComment/csatSubmittedAt` (schema ~504); a survey reply is captured in `messages.service.ts` (~1135-1154); dashboards average by `resolvedById`. It is conversation-level and **not attributed to AI replies**; whether AI-handled conversations are distinguishable was not established |
| Message-level thumbs up/down | **PARTIAL** | Two unconnected mechanisms: (a) `AiInteractionLog.feedbackRating/Label/Note` (1-5, set from the inbox suggestion prompt; `ai-logs/ai-logs.service.ts submitFeedback`, tenant-scoped `updateMany`) is **read by nothing in learning**; (b) `AiEvaluationFeedback.rating GOOD|BAD` per evaluation, set via `POST /ai-learning/interactions/:id/feedback`, **admin-only** (`ai-learning.controller.ts` `@Roles(UserRole.ADMIN)`) |
| Agent corrections | **PARTIAL** | Expected action/reply captured on `AiEvaluationFeedback`; `AiCustomerCorrection` records a *customer* correcting the AI (category enum); an agent cannot propose a better reply from the inbox without admin rights |
| Conversation ratings | **PARTIAL** | CSAT above only |
| Human-edited AI responses | **VERIFIED** (captured, unused for learning) | `AiInteractionLog.finalSentMessage`, `editedByAgent`, `status` (SUGGESTED/SENT/EDITED...) via `PATCH /ai-logs/:id/status`; nothing derives training signal from the edit |
| Conversation outcome tracking | **PARTIAL** | `AiInteractionEvaluation.humanTakeoverFollowed` and `takeoverClassification` exist but are **never populated automatically** (only by human feedback input); resolution/handoff states exist on `Conversation` but are not joined to AI turns |
| AI response quality evaluation | **VERIFIED** | `ai-learning/ai-interaction-evaluator.service.ts` (LLM judge, 10 dimensions 0-5: contextUnderstanding, accuracy, naturalness, intentHandling, commerceReasoning, toolSelection, toolExecution, handoffQuality, conversationContinuity, responseAppropriateness; 29 failure categories; severity; false action/success claim flags; customer-correction detection; `needsHumanReview`); persisted in `AiInteractionEvaluation` |
| Knowledge retrieval quality evaluation | **MISSING** | The judge payload (`judge-input.util.ts`) contains prior messages, customer message, AI reply and only `{latestOrderStatus, handoffTaskExists, conversationStatus}`. Retrieved articles and tool results are **not** sent, although the retrieval trace and tool trace are stored on the execution. No groundedness/unsupported-claim dimension or failure category exists (`WRONG_INFORMATION` is the nearest) |
| Prompt or personality versioning | **PARTIAL** | Platform-level prompt versions exist (2.2). Workspace `AiAgent`/`TenantSettings` personality and instructions have **no history**. `DigitalSelf.profileVersion` counts learned messages, not approvals |
| Learning examples | **VERIFIED** | `AiTrainingExample` (DRAFT/REVIEW/APPROVED/REJECTED/ARCHIVED; customer input, actual and expected response/action, failure categories, approver and time); created from an evaluation that has human feedback; APPROVED requires a customer message and an expected action or reply (`ai-learning.service.ts`) |
| AI response analytics | **VERIFIED** | `GET /ai-learning/overview` (counts by status, average score, needs-review, false claims, customer corrections, top 10 failure categories); `GET /ai-logs/analytics`; AI Analytics tab |
| Admin review and approval workflows | **VERIFIED** (example-level) | Interaction list, failures queue, feedback, training-example create/status/regression-case (`ai-learning.controller.ts`, all ADMIN); HIGH/CRITICAL evaluations create an internal review task once (`ai-interaction-eval.processor.ts ensureReviewTask`) |
| Audit trail | **VERIFIED** (learning actions) | `AiLearningAuditLog` (actor, action, target, previous/new state) written for feedback, corrections, example status changes, regression marking |
| Asynchronous evaluation | **VERIFIED** | trigger -> BullMQ -> processor (3.1) |
| Regression harness | **VERIFIED** | `ai-core/quality/*` scenario harness, `commerce/evaluation/*` runner; `AiTrainingExample.regressionCaseCreated` marks a manual promotion (an engineer edits source; the API does not write it) |
| Dataset export | **VERIFIED** | `ai-learning/dataset/*` CLI with purge; documented in `docs/AI_LEARNING_CONVERSATION_DATA.md` (not re-read here) |

### 3.1 How evaluation is triggered and protected today (VERIFIED)
`AiLearningTriggerService.maybeEnqueue()` runs from `AiExecutionsService.record()`: only task type `RESPONDER` (or a simulated TEST turn), only status SUCCESS, only with a conversation, **only if platform flag `ai_learning_system` is enabled for the tenant** (fail-closed; flag rollout is by tenant list). Job id `ai-interaction-eval-<executionId>` (idempotent), 3 attempts with exponential backoff, results kept 500. The processor re-checks the flag, skips an execution that already has a final evaluation (including human-approved/rejected ones) **before any paid call**, treats only server/network errors as retryable, never retries a permanent failure, writes conditionally so a duplicate cannot overwrite a human decision, and creates the review task at most once. The judge is told that all text is untrusted data. Evaluation row `aiExecutionId` is unique. Simulated (Test Chat) turns draw on a per-tenant **daily simulated-evaluation budget** (`SimulationLimitsService.reserveEvaluation`).

### 3.2 How approved learning reaches the live prompt today (VERIFIED)
`ai-learning/corrections/approved-corrections.service.ts` `getGuidanceBlock(tenantId, customerMessage)`: reads up to 200 newest **APPROVED** `AiTrainingExample` rows of **that tenant** with `digitalSelfId = null`, selects those relevant to the current message (`correction-selection.util.ts`, similarity thresholds), drops any whose text trips `detectInjection`, **redacts personal data** (`redactText`) and truncates, then formats a "REVIEWED GUIDANCE FROM THIS BUSINESS" block that states it never overrides the rules above or tool results. Any error yields an empty block. A global env switch `AI_CORRECTIONS_DISABLED=true` turns it off. Called by `KbRelevantContextSource`, `HybridKnowledgeContextSource`, `CommerceAiService` and `AiResponderService`, i.e. all three response paths. Style-only approved corrections additionally refine one agent's Digital Self (`digital-self/digital-self-corrections.service.ts`, only categories ROBOTIC_RESPONSE/TOO_VERBOSE/TOO_SHORT, weighted, reversible exactly).

---

## 4. Identified gaps (against the goal)

| # | Gap | Status today | Consequence |
|---|---|---|---|
| G1 | Workspace-level learning settings and pause | **MISSING.** Only: platform flags `ai_learning_system`, `digital_self`; global env `AI_CORRECTIONS_DISABLED`; per-agent `DigitalSelf.learningPaused` | A workspace admin cannot pause evaluation or guidance without a platform operator; no sampling rate or spend limit |
| G2 | Cost tracking of learning model use | **MISSING.** The judge posts straight to DeepSeek with an environment key (`ai-interaction-evaluator.service.ts callJudge`), bypassing `ProviderRegistryService` and `AiMeteredProviderService`; reported tokens are only logged ("Judge call used N input and M output tokens") and not persisted; `AiInteractionEvaluation` has no token/cost fields | The platform pays for evaluation with no per-workspace visibility or cap. Credits are untouched (good), but there is nothing to report or limit |
| G3 | Runaway-cost protection for real traffic | **PARTIAL.** Idempotent job id, bounded payload (9,000 chars), `max_tokens: 500`, 3 attempts; flag per tenant. **No sampling, no daily/monthly cap, no queue rate limiter** for real (non-simulated) evaluations | Enabling the flag for a busy workspace means one paid judge call per AI reply |
| G4 | Agent feedback in the inbox | **PARTIAL** (see section 3) | Agents (not just admins) are the people who notice bad replies; their 1-5 ratings go nowhere |
| G5 | Evaluation depth | **PARTIAL** | No retrieval/groundedness, policy-compliance or resolution dimensions; judge blind to retrieved knowledge and tool results; outcome fields never filled automatically |
| G6 | Learning proposals | **MISSING** | `overview` shows top failure categories; nothing turns recurring weaknesses into reviewable proposed changes |
| G7 | Versioned learning layer, activation and rollback | **MISSING** | Approval is per example; there is no atomic "active learning version", no diff, no rollback to a previous set, no attribution of a reply to the guidance that shaped it (`AiExecution` records `promptVersionId` only) |
| G8 | Audit of personality/instruction/setting changes | **PARTIAL** | `AiLearningAuditLog` covers learning actions only |
| G9 | Retention | **MISSING** | No retention or purge job for `AiInteractionLog`, evaluations, feedback or examples was found (only the dataset-export purge) |
| G10 | Learning effect measurement | **MISSING** | No way to compare quality with and without a guidance set |
| G11 | Naming/navigation mismatch | **VERIFIED** | The learning UI is a tab on the AI page; the Digital Self UI is on the Team page and conversation header; no "Digital Self -> Learning" location exists |

---

## 5. Recommended learning architecture (all PROPOSED)

### 5.1 Principle: three layers, one new
| Layer | What it holds | Status |
|---|---|---|
| A. Per-agent **style** (Digital Self) | How a human agent writes | exists; unchanged |
| B. **Reviewed examples** (training examples -> approved guidance) | Situation-specific "when a customer says X, do Y" | exists; unchanged except that it is wrapped by the new version/gates |
| C. **Workspace learning version** | Approved, structured preferences, response-style guidance and knowledge guidance, produced from accepted proposals | **PROPOSED (new)** |

The evaluator, feedback, examples and audit log are reused. New: settings, a usage ledger, proposals, versions.

### 5.2 Human feedback (A) - PROPOSED, reusing existing tables
- Agents rate any AI reply (good/bad, reason from the existing failure taxonomy, free-text "what was wrong", "what a better reply is") from the message in the inbox.
- Storage: **reuse** `AiInteractionEvaluation` (it already has `evaluationSource AUTOMATIC | MANUAL` and a unique `aiExecutionId`) plus `AiEvaluationFeedback`. When an agent rates a reply that has no evaluation yet, create a MANUAL evaluation row for that execution, then the feedback. This links feedback to workspace, conversation, message (`messageId`) and execution without a new table.
- Authorization: a new agent-level endpoint limited to rating and notes on conversations the agent can see; **correcting/approving stays ADMIN-only** (the existing controller's guard).
- Duplicate protection: `AiEvaluationFeedback.evaluationId` is already unique (an agent's second rating updates, and the history goes to the audit log); also record `reviewerId`.
- Bridge `AiInteractionLog.feedbackRating` (1-5): either stop collecting it in the UI in favour of the new control, or map 1-2 -> BAD, 4-5 -> GOOD when the new control is introduced (decision D5).

### 5.3 Automated evaluation (B) - PROPOSED extensions of the existing evaluator
Keep: trigger, queue, idempotency, retry classification, conditional writes, review tasks.
Add:
1. Send the judge a **bounded retrieval summary** (article titles and the first N characters of each retrieved article, from the stored trace and a tenant-scoped lookup) and the **sanitised tool trace**, marked as data, so it can flag **unsupported claims** and **poor retrieval**.
2. New dimensions: `groundedness`, `policyCompliance`, `resolution`, `tone` mapping (keep `naturalness`), `escalationQuality` (reuse `handoffQuality`); new failure categories `UNSUPPORTED_CLAIM`, `POOR_RETRIEVAL`, `POLICY_VIOLATION` (additive enum values; migration).
3. Outcome signals computed by code, not by the model, and stored separately from the score: handoff after the AI reply, customer restating the same question within a window, conversation resolved with or without human reply, CSAT when present. These fill the unused `humanTakeoverFollowed` field. **Never** use conversation length or thanks alone as a quality signal (stated in the evaluator prompt and tested).
4. Route the judge through the provider layer under a new non-metered task type `LEARNING_EVAL`, so it uses the same provider/retry code, **never** `AiMeteredProviderService`/`AiCreditsService`, and records usage in the new ledger (5.6).
5. The evaluator keeps its current isolation: it receives data and returns scores. It has no messaging, commerce or tool services (test in section 11).

### 5.4 Learning proposals (C) - PROPOSED
- A scheduled per-workspace job (one BullMQ job per workspace per period, deterministic job id) reads **only that workspace's** evaluations, human feedback, approved/rejected examples and outcome signals.
- Step 1 is deterministic: group by failure category and situation, require a minimum support (for example at least N distinct conversations and M distinct customers), compute counts and example references.
- Step 2 optionally asks the model to phrase a proposal from the aggregated evidence (one bounded call, cost recorded).
- A proposal is structured, not free text: `kind` (STYLE_PREFERENCE | PHRASING_GUIDANCE | KNOWLEDGE_GUIDANCE | DO_DONT), a small typed payload, a rationale, and **evidence references** (evaluation ids, feedback ids, counts) shown to the reviewer. Customer text appears only as quoted evidence, never as an instruction.
- Proposals are never applied automatically. Duplicate proposals for the same pattern are prevented by a unique `(tenantId, dedupeKey)`.

### 5.5 Human approval, versions, rollback (D) - PROPOSED
- Admin-only approve/reject with a note. Approving one or more proposals **creates a new immutable learning version** (draft assembled from currently active content plus the accepted changes, validated against the allowlist schema below) and, on the admin's confirmation, activates it. Activation is one transaction: archive previous ACTIVE, set the workspace's active version pointer, write the audit entry, invalidate the cache.
- **Rollback** = activate an earlier approved version (a new activation record; versions are never edited or deleted). Unlike platform prompt versions, re-activating an older version is allowed here.
- Complete audit trail via the existing `AiLearningAuditLog`, extended with actions for proposal decision, activation, rollback, pause/resume and settings change; previous/new state captured.

### 5.6 Cost and settings - PROPOSED
- `AiLearningSettings` per workspace (section 6) with enable switches, pause, sampling, caps, retention.
- `AiLearningUsage` append-only ledger of every learning model call (kind, tokens, estimated cost). **Never** written to `AiCreditTransaction`, never touches the workspace's balance. The usage is shown to workspace admins and platform admins.

### 5.7 Workspace isolation (E) - see section 9.

### 5.8 Content allowlist for a learning version - PROPOSED
A version's JSON may contain only: response-style preferences (bounded enums like the existing `OVERRIDE_OPTIONS`), phrasing guidance items (`situation`, `guidance`, length-capped), knowledge guidance notes (clarifications and preferred-article hints, length-capped), and do/don't statements. It has **no field** for tools, permissions, pricing, payments, credits, handoff rules, safety rules or system instructions, so these cannot be changed by learning by construction. Every text is passed through the existing `detectInjection` screen, personal-data redaction and length caps before storage and again before injection.

---

## 6. Database changes proposed

Inspected first: existing models can carry most of the data. Reuse: `AiInteractionEvaluation` (+ MANUAL source), `AiEvaluationFeedback`, `AiTrainingExample`, `AiLearningAuditLog`, `AiInteractionLog`, `AiExecution`. Additive changes only; none destructive. All new tables carry `tenantId` with a foreign key to `Tenant` (`onDelete: Cascade`) and an index leading with `tenantId`. Production's migration history diverges slightly from the repository (see `docs/RELEASE_BLOCKER_REMEDIATION_2026-11-02.md`), so each migration needs the usual preflight against a sanitised copy.

| Model / change | Purpose | Key fields | Relationships and indexes | Retention |
|---|---|---|---|---|
| **`AiLearningSettings`** (new, 1:1 tenant) | The workspace switch panel | `tenantId @unique`, `learningEnabled`, `evaluationEnabled`, `proposalsEnabled`, `paused` (+`pausedAt`, `pausedById`), `sampleRatePercent`, `dailyEvaluationCap`, `monthlyLearningBudgetUsd`, `activeVersionId?`, `retentionDays` | FK tenant; unique tenantId | lives as long as the tenant |
| **`AiLearningUsage`** (new) | Cost ledger, separate from credits | `tenantId`, `kind` (EVALUATION, PROPOSAL), `refType/refId`, `model`, `inputTokens`, `outputTokens`, `estCostUsd`, `createdAt` | index `(tenantId, createdAt)`; unique `(tenantId, refType, refId)` to stop double counting | 13 months, then aggregated |
| **`AiLearningProposal`** (new) | Reviewable improvement | `tenantId`, `kind`, `title`, `payload` JSON, `rationale`, `evidence` JSON (ids, counts), `dedupeKey`, `status` (PROPOSED, APPROVED, REJECTED, SUPERSEDED, EXPIRED), `decidedById`, `decidedAt`, `decisionNote`, `generatorRun` | unique `(tenantId, dedupeKey)`; index `(tenantId, status, createdAt)` | decided proposals kept for audit; undecided expire after a set period |
| **`AiLearningVersion`** (new) | Immutable approved snapshot | `tenantId`, `versionNumber`, `content` JSON (allowlist schema), `contentHash`, `status` (DRAFT, ACTIVE, ARCHIVED), `sourceProposalIds[]`, `createdById`, `activatedById`, `activatedAt`, `rollbackOfId?`, `note` | unique `(tenantId, versionNumber)`; partial unique "one ACTIVE per tenant"; index `(tenantId, status)` | kept (small) |
| `AiExecution.learningVersionId` (new nullable column) | Attribute a reply to the guidance active at that time; enables experiments and audit | nullable string | index `(tenantId, learningVersionId)` | with executions |
| `AiInteractionEvaluation`: new nullable `inputTokens`, `outputTokens`, `judgeModel`, `sampled` | Keep per-evaluation cost next to the result (or only the ledger) | nullable | none | with evaluations |
| Enum additions: `FailureCategory` (`UNSUPPORTED_CLAIM`, `POOR_RETRIEVAL`, `POLICY_VIOLATION`) | New judged failure types | - | `ALTER TYPE ... ADD VALUE` (cannot be rolled back in place; plan accordingly) | - |
| `AiLearningAuditLog`: new action strings only | Extend audit | no schema change | existing indexes | per policy (G9) |

Not proposed: a separate feedback table (reuse MANUAL evaluations), a new example table (reuse `AiTrainingExample`), any cross-tenant table, any vector store of customer text for learning.
Existing-data note: backfill is not required; a workspace with no settings row behaves as today (see 7.4).

---

## 7. Exact Digital Self integration points

### 7.1 Where approved learning enters the pipeline (PROPOSED, on VERIFIED code)
The safest integration point is the seam that already carries approved guidance:

`ApprovedCorrectionsService.getGuidanceBlock(tenantId, customerMessage)` (`ai-learning/corrections/approved-corrections.service.ts`).

Reasons (all VERIFIED): it is called by every response path (`KbRelevantContextSource`, `HybridKnowledgeContextSource`, `CommerceAiService`, `AiResponderService`); it runs **after** retrieval and appends to the `knowledge_base` template variable, so no stored prompt template changes; its output is placed **before** the code-appended `SHARED_STYLE_RULES`, identity/safety block and handoff block in `PromptBuildStage`, so learning cannot displace them; it already fails closed to `''`; and it is already tenant-scoped.

Proposal: keep the method signature; internally compose `[active learning version block] + [approved examples block]`, both gated by `AiLearningSettings` (enabled, not paused). The version block is capped (for example 1,200 characters), labelled as reviewed guidance from this workspace, and carries the same line that it never overrides the rules above or tool results.

Ordering in the final prompt (unchanged mechanism): template body (identity, personality, tenant instructions, knowledge base + reviewed guidance + Digital Self style) -> shared style rules -> identity and safety -> handoff block.

### 7.2 What it must not bypass (VERIFIED mechanisms to keep intact)
Retrieval (learning adds no documents), `GuardStage` injection blocking (runs first), tool allowlist (`resolveToolNames`, `AiAgent.allowedTools`), `PolicyStage`, `EscalationStage` and `handOffBeforeReply`, `AiMeteredProviderService` credit reservation/settlement, `detectInjection`, tenant scoping.

### 7.3 Stamping and attribution (PROPOSED)
Record `learningVersionId` on `AiExecution` (via the trace) so every reply is traceable to the guidance version that shaped it, and so experiments and rollback analysis are possible.

### 7.4 Behaviour when learning is off (PROPOSED requirement)
No settings row, `learningEnabled=false`, `paused=true`, flag off, or any error -> the block is exactly `''` and the prompt is byte-for-byte what it is today (to be asserted by a test).

### 7.5 Digital Self (style) layer
Unchanged. Learning proposals of kind STYLE_PREFERENCE are workspace defaults for tone and are **not** written into any agent's Digital Self; the existing style-correction path (approved style-only examples refine one agent's profile) stays as is.

---

## 8. Dashboard integration

Verified starting point: `/ai` has a **Learning** tab (`AiLearningTab.tsx`: stat cards, interaction table, feedback form) using the page's existing tab pattern, `StatCard`, tables and toasts. Digital Self management is in Team (admins) and the conversation header picker.

Recommendation (PROPOSED, reuse existing patterns, no redesign):
- **Phase 1 location:** keep the entry on the existing AI page (**AI -> Learning**) and add an inner sub-navigation with the same tab styling: **Overview**, **Feedback**, **Evaluations** (today's table), **Improvement proposals**, **Version history**, **Audit history**, **Settings**.
- **Your preferred label "Digital Self -> Learning":** there is no Digital Self navigation item today, and the Digital Self is a per-agent style tool, not the workspace's learning target. Two options: (a) keep AI -> Learning and add a short explanatory link between the two screens; (b) create a "Digital Self" parent page that groups the agent-style screen and the Learning screens. Option (b) is more navigation work and risks implying that learning edits agent styles. This is decision D1.
- Inbox: a small good/bad control with a reason and "what would have been better" on AI messages, replacing the current post-send 1-5 prompt (D5).
- Permissions in the UI mirror the server: agents rate, admins review/approve/pause; hidden buttons are never the authorization.
- Mobile: parity later; the Learning tab exists on mobile.

---

## 9. Security and workspace isolation design

### 9.1 Verified current isolation
Every learning read in the code I inspected is tenant-scoped (`ai-learning.service.ts`: all `where` clauses carry `tenantId`; `InteractionContextResolver.resolve(tenantId, executionId)`; `ApprovedCorrectionsService`; Digital Self lookups use `{ id, tenantId }`). Evaluations are created from the tenant's own executions. `AiLearningController` is `JwtAuthGuard + RolesGuard + @Roles(ADMIN)`. No cross-workspace learning data path was found. There is **no database-level row security**; isolation is enforced in application queries.

### 9.2 Required properties and how the design enforces them
| Requirement | Mechanism (PROPOSED unless marked) |
|---|---|
| No cross-workspace influence | every new table keyed by `tenantId`; every query includes it; generator job reads one workspace per run; no shared example pool, no shared embeddings; the shared model receives only that workspace's text |
| Only human-approved changes influence live replies | only an ACTIVE `AiLearningVersion` (created by an admin action) and APPROVED examples are read at reply time; proposals and drafts are never read there |
| Customer messages are untrusted | they appear only as quoted evidence; the proposal generator and judge are told they are data; version content is a structured allowlist (no free-form instruction field); `detectInjection` + redaction + caps on store and on load (**VERIFIED** for examples today) |
| Safety boundaries untouchable | content schema has no tool/permission/credit/handoff/safety fields; identity and safety block is appended by code after the body (**VERIFIED**); the evaluator and generator services import no messaging, commerce-tool or credit services (enforced by a test) |
| Evaluator cannot message customers or act | it only reads and writes learning tables; its one side effect (internal review task) already exists |
| Pausable per workspace without disabling Digital Self | `AiLearningSettings.paused` stops evaluation enqueueing, proposal generation and version injection for that workspace only; style blocks and the AI itself continue |
| Authorization | admin-only for approve/reject/activate/rollback/settings (reuse `RolesGuard`); agents limited to rating; tenant id always from the token, never the request |
| Auditability | every state change appended to `AiLearningAuditLog` with previous/new state |

### 9.3 Risks specific to learning
Prompt poisoning through approved text (mitigated above, residual: a reviewer approving malicious wording; show the exact injected block in the approval screen), data minimisation (customer text goes to the judge's provider; D3), retention (G9), reviewer overload (rate-limit proposals), and stale guidance (review dates, expiry).

---

## 10. Cost and performance controls (PROPOSED unless marked VERIFIED)

| Control | Status |
|---|---|
| Evaluation runs after delivery, off the reply path | **VERIFIED**: fire-and-forget enqueue after `AiExecution` is stored; flag lookup + `queue.add` only |
| Idempotent enqueue per execution, unique evaluation per execution, final rows never overwritten | **VERIFIED** |
| Bounded judge input (9,000 chars) and output (`max_tokens` 500); bounded attempts (3) | **VERIFIED** |
| Retry only for server/network errors; permanent failures not retried | **VERIFIED** |
| Duplicate human feedback prevented | **VERIFIED** (unique `evaluationId`) |
| Workspace pause and enable switches | PROPOSED (`AiLearningSettings`) |
| Sampling (evaluate a percentage; always evaluate escalations, tool failures and agent-rated replies) | PROPOSED |
| Per-workspace daily evaluation cap and monthly learning budget, checked before each paid call, enforced atomically (reserve-then-record like `SimulationLimitsService`) | PROPOSED (the simulated-evaluation budget is the **VERIFIED** pattern to copy) |
| Queue rate limiter and concurrency cap on `ai-interaction-eval`; global kill switch (environment) in addition to the per-workspace pause | PROPOSED |
| Usage recorded per call in `AiLearningUsage`, shown to admins; never deducted from AI credits | PROPOSED; today usage is only a log line |
| Proposal generation at most once per workspace per period, minimum evidence threshold, one bounded model call, hard token ceiling | PROPOSED |
| Read path cost: one cached lookup of the active version (invalidate on activate/rollback/pause, short TTL as the feature-flag cache) | PROPOSED |
| Dead letters: failed jobs retained (`removeOnFail`) and surfaced as FAILED evaluations (**VERIFIED** status exists); alert on sustained failure | PARTIAL / PROPOSED |

---

## 11. Testing strategy

Existing coverage to build on (VERIFIED by file names): `ai-interaction-eval.processor.spec.ts`, `ai-interaction-evaluator.service.spec.ts`, `judge-input.util.spec.ts`, `corrections/correction-loop.journey.spec.ts`, `correction-selection.util.spec.ts`, `approved-corrections.service.spec.ts`, `digital-self/*.spec.ts`, `digital-self.db.integration.spec.ts`, `hybrid-rag-and-digital-self.integration.spec.ts`, `credit-governed-ai.spec.ts`, and the two-workspace database suite pattern in `tenant-isolation.db.spec.ts`.

| Required test (PROPOSED unless noted) | Type |
|---|---|
| Cross-workspace isolation: feedback, evaluations, proposals, versions, usage and injected blocks of workspace A never appear for B (two real workspaces on a real database; mutation check by removing a `tenantId` filter) | integration (disposable Postgres) |
| Unauthorized approval: agent, viewer, another workspace's admin, expired token, and a request carrying a foreign `tenantId` cannot approve, reject, activate, roll back or change settings | unit + integration |
| Feedback poisoning: customer text containing instructions ("ignore previous rules", fake system lines, tool names) never becomes an instruction, is screened/redacted/capped, and cannot alter the allowlisted version fields | unit |
| Unapproved never live: proposals, DRAFT versions and REJECTED/ARCHIVED items are never present in the prompt built for a reply | unit + pipeline test |
| Rollback correctness: activate v3, roll back to v2, prompt equals v2 exactly; one ACTIVE per workspace under concurrent activation | integration |
| Duplicate evaluation prevention: same execution enqueued twice, redelivered job, retry after crash -> one evaluation, one paid call (**partly VERIFIED existing**) | unit + queue test |
| Queue failures and retries: provider 5xx retried then FAILED; 4xx not retried; Redis outage never blocks the customer reply | unit |
| Pause/resume: paused workspace enqueues nothing, injects nothing; resume restores; other workspaces unaffected; Digital Self style still applied while paused | integration |
| Credit accounting unaffected: balances, reservations and `AiCreditTransaction` rows identical with learning on vs off; learning calls create only `AiLearningUsage` rows | integration |
| Behaviour unchanged when learning is disabled: the rendered prompt is byte-identical to today's for a fixed set of scenarios (golden test over the quality harness in `ai-core/quality`) | unit |
| Evaluator isolation: the evaluator and generator modules do not import messaging, commerce-tool or credit services (static import test) | unit |
| Budget/cap enforcement under concurrency (no overspend by parallel jobs) | integration |
| Migration safety: additive migrations apply on a copy of the current schema and `migrate diff` shows only the intended objects | disposable-local |
| Quality measurement: with `learningVersionId` stamped, a fixed scenario set scored with and without the version (a model call, run on demand, not in CI) | manual / staging |

---

## 12. Phased implementation plan

| Phase | Scope | Reuses | New | Exit criteria |
|---|---|---|---|---|
| 1. Foundation | `AiLearningSettings`, `AiLearningUsage`, per-workspace pause/enable/sampling/caps, judge routed through the provider layer with usage recorded, queue limiter, global kill switch; admin Settings screen; audit actions | evaluator, trigger, flags, audit log | 2 tables, settings API, small UI | learning can be paused per workspace; every judge call is attributed and capped; behaviour with defaults identical to today; isolation and credit-accounting tests green |
| 2. Feedback in the inbox | agent good/bad + reason + better reply on AI messages; MANUAL evaluations; admin-only correction/approval kept | `AiInteractionEvaluation`, `AiEvaluationFeedback`, existing taxonomy | agent endpoint, inbox control | feedback linked to workspace, conversation, message; duplicates update not multiply |
| 3. Automated evaluation depth | retrieval summary + sanitised tool trace to the judge, new dimensions/categories, code-computed outcome signals | evaluator, retrieval trace, tool trace | enum additions, outcome computation | unsupported claims and poor retrieval detected on seeded scenarios; no dependence on length/thanks |
| 4. Proposal generation | per-workspace scheduled aggregation, deterministic first, optional bounded model phrasing | evaluations, feedback, examples | `AiLearningProposal`, generator job | proposals carry evidence; no duplicates; cost bounded and recorded |
| 5. Admin review and approval | Proposals screen with evidence and the exact block that would be injected; approve/reject with notes | AI -> Learning tab patterns | UI + endpoints | only admins decide; decisions audited |
| 6. Versioning, audit, rollback | `AiLearningVersion`, activation transaction, rollback, injection at the guidance seam, `learningVersionId` on executions | `ApprovedCorrectionsService` seam | version table, column | rollback exact; unapproved never live; learning-off prompt byte-identical |
| 7. Controlled experiments | split by a stable hash of the conversation id between "with" and "without" a candidate version; compare evaluation scores, escalation and outcome signals; statistical guardrails | `learningVersionId`, evaluator | experiment config | a change is promoted only on measured evidence |
| 8. Preference training (future) | only when enough high-quality approved data exists per the policy; actual fine-tuning/RLHF/DPO is out of scope for the first implementation and, if ever done, must use a workspace's own approved data only (or a platform-level model trained on data with explicit contractual permission) | exports in `ai-learning/dataset` | n/a | separate decision |

---

## 13. Risks, dependencies and unresolved decisions

### 13.1 Risks
- The evaluator may already be live for some workspaces without caps (G2, G3). Phase 1 first.
- Naming confusion between the Digital Self (agent style) and workspace learning (G11).
- Customer conversation text is sent to an external model provider for judging; contractual and consent position unknown to me (D3).
- Judge quality: an LLM judge can be wrong or biased; scores are advisory and human review gates anything that changes behaviour.
- Reviewer fatigue and stale guidance; mitigated by evidence thresholds, expiry and a visible "exact injected text" preview.
- Three response paths (Commerce, v2, legacy) share the seam, but the legacy path is scheduled for retirement; the design should not add anything legacy-only.
- Enum additions are not reversible in place; migration needs the usual preflight, and production's history differs slightly from the repository.
- Hybrid RAG and retrieval trace shape are uncommitted work; evaluation depth (Phase 3) depends on the trace format being stable.
- Effect measurement needs enough volume per workspace; small workspaces may never reach significance.

### 13.2 Dependencies
Per-workspace settings before anything else; the provider layer for non-metered learning calls; the Phase 1 usage ledger before enabling more evaluation; legal/consent position before wider rollout; committed state of the uncommitted branch work (the exact-SHA process in `docs/STAGING_RELEASE_PREFLIGHT_2026-11-02.md`).

### 13.3 Decisions needed from you
| # | Decision | My recommendation |
|---|---|---|
| D1 | Where does it live: AI -> Learning, or a new Digital Self parent page? | AI -> Learning now; revisit once the naming is settled |
| D2 | Who may rate AI replies: agents and admins, or admins only? | Agents rate; admins approve |
| D3 | May customer conversation text be sent to the judge provider, per workspace, and what must workspaces be told/consent to? | needs your legal view; add an explicit per-workspace opt-in in settings |
| D4 | Retention periods for interactions, evaluations, feedback, examples, usage | proposed 13 months for usage, a shorter period for raw conversation text in evaluations; confirm |
| D5 | Replace the post-send 1-5 prompt with good/bad + reason, and what to do with existing 1-5 data | replace; map existing ratings only for reporting |
| D6 | Who pays for learning calls: platform absorbs, or per-workspace budget/plan allowance? (Cost must not be taken from AI credits unless you decide it explicitly and transparently) | platform absorbs with caps in Phase 1; revisit with usage data |
| D7 | Two-person approval for activating a version? | optional setting, off by default |
| D8 | Default sampling rate and caps | start low (for example 10% plus all escalations), per-plan later |
| D9 | Should a workspace be able to export or delete its learning data (versions, examples, feedback)? | yes; tie to the existing data-deletion page |
| D10 | Judge model/provider (currently DeepSeek via environment key) | route through the provider registry; choice is a cost/privacy decision |

---

## 14. Summary

**Already exists (VERIFIED):** an asynchronous, idempotent LLM evaluation pipeline with human review and a failure taxonomy; admin feedback, customer-correction records and reviewed training examples with an approval step; an approved-guidance block that reaches all three response paths with injection screening and personal-data redaction; an audit log; per-agent Digital Self style learning with pause, reset and exact removal; platform-level prompt versions; credit reservation/settlement that the learning code never touches; a learning tab on the AI page.

**Missing:** workspace-level learning settings, pause, sampling and caps; stored and attributed learning cost; recurring-weakness proposals; set-level learning versions with activation and rollback and reply-to-version attribution; agent feedback from the inbox into the evaluation system; judge access to retrieval and tool context; automatic outcome signals; retention; measurement of the effect of a change.

**Recommended first implementation phase:** Phase 1, Foundation (`AiLearningSettings`, `AiLearningUsage`, per-workspace pause and caps, judge through the provider layer, global kill switch, a Settings screen, audit actions). It changes no customer-visible behaviour, makes the already-existing evaluator controllable and billable internally, and is the prerequisite for every later phase.

Nothing in this report has been implemented; no code, schema, migration, configuration, prompt or UI was changed.
