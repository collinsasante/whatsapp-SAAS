# Verz AI — Phase 1 Audit (pre-upgrade baseline)

Written before the grounded-retrieval/verification/escalation upgrade in this
branch. Captures the state of `ai-responder.service.ts`, `ai-logs.service.ts`,
`knowledge-base.service.ts`, the AI branch of `messages.service.ts`, the AI
settings UI, and the Prisma schema as they existed on `dev` at the time.

## Retrieval

`KnowledgeBaseService.getActive()` selected **every active article for the
tenant, unranked, uncapped**, and concatenated all of them into the prompt. No
chunking at retrieval time (chunking only existed on *ingestion*, for file/URL
uploads, capping at 3000 chars per article). No token counting, no truncation
strategy, no relevance ranking. A tenant with a large KB would either blow past
useful context or dilute relevance so badly the model couldn't tell what
mattered.

## Confidence semantics

- Backend computed 0–100, hard-capped at 40 for a small set of fallback-phrase
  matches.
- Frontend (`ChatWindow.tsx`) hardcoded its own **70%** threshold for a "Human
  Review Recommended" label — not read from config, not connected to the
  backend's cap logic, not per-tenant.
- **AUTO_REPLY sent regardless of confidence.** No gate existed at all — a
  low-confidence, effectively-guessed answer went out exactly like a
  high-confidence one.

## Suggestion telemetry

`AiInteractionLog` already had `SUGGESTED/APPROVED/EDITED/REJECTED/AUTO_SENT`
status, `editedByAgent`, `finalSentMessage`, feedback rating, and a real
analytics rollup (`AiLogsService.getAnalytics`). More built than expected.
**But**: `ChatWindow.tsx`'s "Edit & Send" button populated the compose box and
dropped the log reference entirely — `EDITED` was a status that existed in the
schema and was never written by the UI. Every edited-then-sent suggestion was
invisible in the data.

## Injection defense

`ai-responder.service.ts` had 10 regexes. `ai-logs.controller.ts`'s
`/ai-logs/test` sandbox kept its **own separate copy of 7**, missing several
patterns present in the real pipeline's list. The test console could pass a
message as "safe" that the real pipeline would block.

## Failure handling

Both SUGGESTION and AUTO_REPLY paths: a DeepSeek timeout/error/malformed JSON
was caught, logged, and the caller got an empty response and did nothing. In
AUTO_REPLY mode that meant the customer's message got no reply at all,
silently, unless a human noticed. No retry, no backoff, no escalation.

## Debouncing / idempotency

None. Every inbound message independently triggered the full pipeline with no
debounce window and no idempotency key on message id. Three rapid customer
messages meant three independent `generateSuggestion()` calls (and, in
AUTO_REPLY, three credit deductions).

## Interaction with the chatbot-flow system

A separate keyword/flow-based automation system
(`chatbotFlowsService.findMatchingFlow`) runs **before** Verz AI in
`messages.service.ts`. If a flow matches, AI is skipped entirely. Also: if a
human agent has taken over a conversation (`assignedTo` is a real user, not the
AI agent), AI already correctly stayed out — a working escalation primitive,
just not exposed as a general escalation *action*.

## No RAG infrastructure, no eval harness, no CI test execution

Zero embeddings, zero vector storage, zero full-text search. `.env.example`
had no embedding-provider key. **No environment's Postgres image
(`postgres:16-alpine`) has pgvector installed.** The only CI workflow
(`deploy.yml`) ran typecheck+lint before deploy — it never ran `pnpm test`, so
even the pre-existing 47 platform-admin tests weren't gated in CI.

## What shipped in this branch, mapped to this audit

| Audit finding | Fix |
|---|---|
| Dump-the-whole-KB retrieval | Chunking + hybrid vector/FTS retrieval, tenant-scoped |
| No confidence gate on AUTO_REPLY | Per-tenant threshold (default 75), verification-gated |
| EDITED status never written | `ChatWindow.tsx` now records it with an edit-distance ratio |
| Injection list drift | Single exported list, both call sites use it |
| Silent failure handling | `LlmService`: retry+backoff, one repair-reprompt, clean `failed` signal |
| No debounce/idempotency | Not fully implemented this pass -- see deferred list |
| No escalation for human-request/frustration/loops | `EscalationService`, wired pre-generation |
| No eval harness, no CI gate | `test/ai-evals/`, new CI job, real 93% score (see `ai-eval-report.md`) |

## Deferred (not built in this pass, ranked by expected value)

1. **Knowledge-gap clustering dashboard** (Phase 4.2) — schema (`AiKnowledgeGap`)
   exists, clustering algorithm and UI panel do not.
2. **Debouncing rapid customer messages** (Phase 5.3) — a real gap; a burst of 3
   messages still triggers 3 independent generations today.
3. **Latency p50/p95/p99 instrumentation** (Phase 5.2) — `responseTimeMs` is
   logged per-call; no percentile rollup exists yet.
4. **AI settings page UI upgrades** (Phase 7.1) — confidence threshold slider,
   holding-message editor, knowledge-gap panel. The `/ai-logs/test` sandbox was
   upgraded to show sources/action/verification, but the rest of the settings
   page wasn't touched.
5. **Weekly digest job** (Phase 4.4) — not built.
6. **Trial "shadow suggestion" review feed** (Phase 7.4) — not built; the
   existing 30-day observe-then-approve mechanic is unchanged.
7. **Marketing copy fix** ("never sends automatically") — the affected files
   (`llms.txt`, homepage FAQ) live on a separate, not-yet-merged
   `feature/seo-audit-and-foundation` branch, not on `dev`. Needs to be applied
   there specifically when that branch merges.
8. **pgvector / real embeddings upgrade** — documented upgrade path in
   `embedding.service.ts` and the `KnowledgeBaseChunk` schema comment. This is
   the single highest-leverage upgrade for the two genuine retrieval-miss
   failures in `ai-eval-report.md` (paraphrase and phone-number queries).
