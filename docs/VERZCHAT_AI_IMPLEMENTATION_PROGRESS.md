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
| D3 | Failed provider calls leave no `ai_executions` row (none after 2026-10-24 despite many 401s), so outages are invisible to analytics and cannot trigger evaluation | Medium | `NOT_STARTED` |
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
| 1 | Reliable AI foundation (provider abstraction, validation, retries, instrumentation) | `IN_PROGRESS`: D1 done; D3, D4, D6 open |
| 2 | Correct and safe conversations, takeover | `IN_PROGRESS`: takeover rechecks exist and are tested by the repo; no new concurrency work yet |
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

## 6. Tests run (this branch)

| Command (from `apps/backend`) | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx jest src/messages/messages.service.spec.ts` | 92 passed |
| mutation script (7 mutants), `messages.service.ts` | 7/7 caught, restored |
| ad-hoc Postgres query check (disposable DB) | 8/8 correct |
| `npx jest` (full backend) | see "Full-suite result" below |

Full-suite result: 150 suites passed, 1 skipped; 2062 tests passed, 12 skipped; 0 failures (`env -u DATABASE_URL npx jest`, no database, no provider). The 12 skips are existing opt-in suites (live provider and Postgres tests); they are not counted as passed. `git diff --check` exit 0.

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

1. Full-suite result: record it in section 6, then commit D1 + this file on `feature/ai-phase-completion`.
2. D3: record provider failures as `AiExecution` rows (status `PROVIDER_ERROR`) on the legacy path without changing replies.
3. D4: judge input length caps, untrusted-content delimiting, and a per-tenant daily judge-call cap; usage accounting.
4. Bring the `ai-eval` commits onto this branch (cherry-pick) and extend them with the naturalness rubric and the
   baseline-vs-candidate gate for Phase 3.
5. Design the learning-candidate / verification / version / rollback model (needs a reviewed migration; explain risks first).
6. Trace knowledge-base ingestion (Phase 5) before claiming SSRF coverage.
