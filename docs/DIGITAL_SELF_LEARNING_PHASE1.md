# AI Learning / Digital Self — Phase 1 implementation

Branch `feature/digital-self-learning-phase1`, built on the verified release candidate `98a31e3`. This document describes what Phase 1 does and what must still happen before any real workspace uses it. The architecture and product decisions are in `DIGITAL_SELF_LEARNING_ARCHITECTURE.md` and are not repeated here.

**Status: implemented and verified locally. Not deployed, not enabled for any workspace, not validated on staging.**

## 1. Workspace learning settings

Model `AiLearningSettings` (one optional row per workspace). A workspace with **no row** behaves as: learning **off**, not paused, approved guidance **on**.

| Switch | Default | Effect |
|---|---|---|
| `learningEnabled` | `false` | Opt-in. Without it no judge call is made and the Digital Self learner captures no evidence. |
| `learningPaused` | `false` | Stops both of the above without losing the opt-in. |
| `approvedGuidanceEnabled` | `true` | Only controls whether already-approved guidance is added to replies. Independent of the other two. |

`GET /ai-learning/settings` and `PATCH /ai-learning/settings` (workspace admins only). Switching learning **on** needs `acknowledgedDisclosureVersion` (the current notice version, from the settings view) **and** the platform gate `AI_LEARNING_OPT_IN_OPEN=true` (closed by default; operators open it only after privacy approval). Turning off and pausing are always allowed. A workspace cannot set its own budget: the DTO has no such field and rejects unknown fields. Every change is audited (flags only).

**Behaviour change on deploy:** the existing `ai_learning_system` and `digital_self` platform flags are no longer sufficient. A workspace that is learning today (the pilot) stops until it opts in. No workspace is opted in by this change.

## 2. Budget reservation and reconciliation

Platform-funded and **separate from customer AI credits**: `AiLearningUsage` is its own ledger (micro-USD integers). It never reads or writes `AiCreditTransaction`, `AiCreditReservation` or `Tenant.aiCredits`, and a test asserts this.

Defaults (override with `AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD`, `AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD`, `AI_LEARNING_MAX_RESERVATION_USD`): **USD 5 per workspace per month, USD 50 globally, USD 0.05 per run.** These are safety limits, not predicted costs. "Month" is the UTC calendar month on the database clock.

Every provider call is preceded by `AiLearningCostService.reserve()`, one transaction behind one advisory lock, so the caps are exact under concurrency (tests: 20 concurrent runs in a workspace, 24 across six workspaces, 16 on one execution). One row per **run**:

`RESERVED` → `COMPLETED` (provider-reported usage) · `FAILED` · `EXPIRED` · `FENCED` · `SKIPPED` (not run; recorded when a cap denied it).

- **Row-state fencing.** A partial unique index allows one `RESERVED` row per execution. A takeover first moves the lapsed row to `EXPIRED`, then inserts the next run. A finisher settles with `UPDATE … WHERE state = 'RESERVED'`; if a takeover won, the update matches nothing, the result is `FENCED` and is **not applied** (it is recorded on its own row). A late result can never overwrite a newer run or evaluation.
- **Lease 60 s** on the database clock (provisional; provider deadline 30 s + persistence).
- **Expiry does not release budget.** `EXPIRED` rows keep their maximum estimate against the caps until reconciled by a late `FENCED` settlement or by `reconcileExpired(usageId, actualMicros)` (service method for an operator tool; no endpoint yet). A failure with an unknown outcome (timeout, network, 5xx) also keeps its full reservation; a rejected request (4xx) counts as 0.
- **Run ceiling 4** per execution, enforced in the database (below).
- **Tripwire.** If the provider reports more input tokens than estimated, or a cost above the reservation, the workspace is paused and an error is logged (ids and numbers only).

## 3. Provider and pricing

The judge uses `ProviderRegistryService` → `DeepSeekProvider` with the **existing alias `deepseek-v4-flash`** (a retired name DeepSeek still serves at the Flash price; moving to `deepseek-flash` is a later decision). One provider attempt per run (`maxAttempts: 1`), hard **30 s total deadline** with cancellation (`deadlineMs` / `AbortSignal` on `ChatCompletionRequest`; axios' own timeout is not a total).

`pricing/learning-price-table.ts` holds the rates (peak, cache-miss: **USD 0.30 / 1.20 per million input / output tokens**), a version, `verifiedAt` (2026-11-02) and the source URL; the version is stored on every ledger row. **Update it when DeepSeek's page changes.** The repository's model catalogue (0.14 / 0.28) is stale and is not used here.

The input-token estimate for a reservation is the request's UTF-8 byte length plus fixed allowances. That is a conservative engineering bound, **not a tokenizer guarantee from DeepSeek**; settlement always uses the provider-reported usage, and the tripwire catches a violation. If the provider reports no usage, nothing is invented: the reservation stays counted.

## 4. BullMQ retry, stall and fencing

Explicit in `learning-queue.constants.ts` and applied where the job is enqueued and in `@Processor`: 3 attempts, exponential 5 s backoff, worker concurrency 1, `lockDuration` 30 s, `stalledInterval` 30 s, `maxStalledCount` 1. Therefore at most **3 attempts + 1 tolerated stall = 4** processor runs, each at most one paid call. Verified against bullmq 5.76.6 with a real Redis (`ai-learning.queue.integration.spec.ts`): a failing job runs 3 times; one stall plus three failures runs exactly 4 (a fifth is refused by the ledger); a second stall fails the job without invoking the processor.

`moveToDelayed` does **not** consume an attempt, and a delayed re-activation is a new activation, so `attemptsMade` is not a safe guard. The ledger is: a delayed or recovered job must pass `reserve()` again, and finds `in_flight`, `already_settled` or `run_ceiling` when it should not pay. An `in_flight` refusal is retried by the queue's backoff with no provider call.

## 5. Privacy erasure on deletion

Deleting a conversation (`ConversationsService.deleteConversation`) or a contact (`ContactsService.remove`, previously a series of separate statements) now runs in **one transaction** with `LearningErasureService`. Any failure rolls the whole deletion back.

Erased: interaction logs, evaluations (with feedback and customer corrections), every training example from the conversation (approved ones included), Digital Self events from the conversation (then each affected profile is **rebuilt** from the events that remain), and the conversation's `ai_review` tasks. `AiExecution.toolTrace`, `errorMessage` and `interactionLogId` are cleared; the rows stay for their usage metrics. Untouched: the cost ledger, AI credits, other conversations and workspaces, and historical orphans.

The audit row holds ids and counts only (approved example ids included, capped at 200 ids, with the full count). After commit, queued evaluation jobs for the deleted conversations are removed and admins are notified when approved examples were removed (both best effort). The evaluation processor also drops a job whose conversation is gone before any provider call, and discards a result rejected by the new foreign key.

**Foreign key.** `ai_interaction_logs.conversation_id → conversations ON DELETE CASCADE`, added `NOT VALID`: new rows are enforced (a log cannot be created for a conversation being deleted — the insert waits for the deleter's lock, then fails), existing orphans are tolerated.

**Operator steps, separate and not done by this change:** (1) review historical orphans (`ai_interaction_logs` rows whose conversation no longer exists), delete them with approval; (2) only then `ALTER TABLE ai_interaction_logs VALIDATE CONSTRAINT ai_interaction_logs_conversation_id_fkey`. `VALIDATE` fails while an orphan exists.

## 6. Retention (disabled)

`AiLearningRetentionService` is **off** unless `AI_LEARNING_RETENTION_ENABLED` is exactly `true`; while off it reads and writes nothing. When on: free text after 90 days (`AI_LEARNING_RETENTION_FREE_TEXT_DAYS`), anonymised metrics after 13 months (`AI_LEARNING_RETENTION_METRICS_MONTHS`). `RETENTION_MANIFEST` in `learning-retention.service.ts` is the exhaustive list of what may change, and a test diffs every learning table row to prove nothing else does. Approved guidance, the cost ledger, credit records, audit logs, Digital Self data and execution usage metrics are never touched. Nothing schedules the sweep; `POST /internal/ai-learning/retention/run` (fail-closed internal secret) is the hook for a scheduler.

## 7. Before any real workspace opts in

1. **Privacy approval** of the retention periods and of what the sweep deletes, and of keeping approved examples (which contain customer text) until an admin archives them — this is not decided in Phase 1.
2. **Workspace disclosure**: built (versioned notice, acknowledgement, controls in the AI Learning tab; see `DIGITAL_SELF_LEARNING_PRIVACY.md`); the wording still needs approval.
3. **Deployment wiring**: Compose now passes the variables to the backend with safe defaults (see the readiness branch); operators must still set them deliberately.
4. **Staging acceptance** on a Phase-1 build: opt-in, one evaluation reserved and settled, a cap denial, a conversation deletion, restore rehearsal with the `NOT VALID` constraint.
5. Operator steps in §5 for historical orphans.
6. The staging seeder now opts the synthetic workspace in explicitly with `--opt-in` (see `digital-self-staging-validation.md`).
7. Confirm price table, margins and caps against real provider billing after the first week; reconcile any `EXPIRED` rows.

## 8. Running the database tests

Disposable local PostgreSQL (all migrations applied; the name must end in `test`) and Redis:

```
AI_LEARNING_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/ailtest \
AI_LEARNING_TEST_ISOLATED_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/ailiso_test \
AI_LEARNING_TEST_REDIS_URL=redis://127.0.0.1:6379 \
npx jest src/ai-learning
```

The isolated database is used only by specs whose assertions span the whole database (global cap, retention). Without the variables those suites are skipped.
