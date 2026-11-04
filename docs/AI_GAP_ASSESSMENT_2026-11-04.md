# AI gap assessment (code review; no staging, provider or production access used)

Companion to `docs/AI_AUDIT_2026-11-04.md`. Status vocabulary: **IMPLEMENTED** (code exists), **UNIT-TESTED** (hermetic tests, providers mocked), **REAL-DB TESTED** (real PostgreSQL), **NEEDS STAGING/PROVIDER** (cannot be claimed without a real run), **NOT IMPLEMENTED**.

## 1. Context limits and conversation continuity
| Path | History window | Notes |
|---|---|---|
| v2 pipeline, verified customer (known contact) | 40 messages across the customer's conversations | `CUSTOMER_HISTORY_WINDOW` in `context-assembly.stage.ts`; fetch buffer +25 then selection |
| v2 pipeline, single conversation | 12 messages | `CONVERSATION_HISTORY_WINDOW` |
| Legacy v1 responder | 200 messages | `LEGACY_HISTORY_WINDOW`; the largest prompt and cost per reply |
| Model | context window 64,000 tokens, max output 4,096 | `model-catalog.ts`, one model (DeepSeek flash) |
Impact: continuity beyond the window relies on conversation facts (`remember_conversation_facts`) and the pending-action state, not on raw history; a long-running customer thread can lose detail older than 12 or 40 messages. Replies cut off at the output limit are rejected (not sent). There is no per-message character cap in the prompt beyond the channel limit (WhatsApp text 4,096 characters); 40 such messages is well under the window, so overflow is unlikely but not impossible with long pasted text. Status: IMPLEMENTED, UNIT-TESTED.

## 2. Images and voice notes: NOT IMPLEMENTED
* The AI receives message text and the caption of an image or video. A bare voice note or image reaches the pipeline as an empty body; history selection drops rows with no text and no caption. The configured provider/model declares only `jsonMode` and `tools`: no vision, no audio.
* To add: (a) **voice**: a speech-to-text provider call on the stored audio (the inbound media is already downloaded to tenant-scoped storage), transcript stored as message metadata and used as the customer text; (b) **images**: a multimodal model call or captioning step, with the description stored and used as context.
* Decisions needed first: provider choice and credentials; cost (no prices are asserted here; the only price in the code, DeepSeek flash at about $0.14/$0.28 per million tokens, is an unverified note in the source); consent and disclosure (customer audio and images would go to a third party; align with the existing privacy disclosure used for Digital Self); retention (transcripts are personal data: tenant-scoped, covered by erasure); failure handling (timeouts and unsupported formats must fall back to "a person will reply", never to a guess); WhatsApp voice is OGG/Opus, Messenger/Instagram audio is MP4/AAC (the repo already transcodes WebM to OGG with ffmpeg for sending); tenant isolation (storage keys carry the tenant id; the transcription job must run under the message's tenant); credit metering through the existing reservation path with its own task type.
* Status: no code, no tests. Not claimed.

## 3. Per-tenant spend limits (proposed; not implemented)
Current control: the tenant's credit balance (`tenants.ai_credits`), reserved before each provider call by `AiCreditsService.reserveForProviderCall/reserveFixedCredits`, which run inside a transaction that takes `SELECT … FOR UPDATE` on the tenant row. That row lock is the right place for a cap because it already serialises all concurrent reservations for a tenant.
Design:
* New settings on `tenant_settings`: `ai_daily_credit_cap` (nullable = no cap) and `ai_alert_threshold_percent` (default 80).
* In `reserve*`, after the lock and before inserting the reservation: compute `spentToday` = sum of `AI_USAGE` ledger rows since local midnight in the tenant's timezone + credits held by open reservations; if `spentToday + requested > cap`, reject with a typed `AiSpendCapReached` error. Callers already treat a failed reservation as "no AI reply" (the conversation is left for an agent); add a once-per-day notification to admins.
* Alerts: when a reservation crosses the threshold, emit one notification per tenant per day (idempotent via a `(tenant, day, kind)` unique row), and surface the figure in the AI usage page.
* Concurrency and retries: the check and insert share one locked transaction, so two replicas cannot both pass; reservations are idempotent by `idempotencyKey`, so a retried request cannot double count; a released reservation (definitive 4xx) frees its headroom immediately.
* Edge cases to test: cap lowered below current spend, cap removed, timezone day boundary, legacy flat-cost path (it goes through `reserveFixedCredits`, so it is covered), failure after provider success but before settlement (the hold stays until expiry, already conservative).
* Status: design only; needs product defaults (who sets the cap, default value) and a migration (two nullable columns).

## 4. Redaction, injection resistance, tools, providers
| Area | State |
|---|---|
| Prompt injection | One shared regex list with Unicode normalisation (IMPLEMENTED, UNIT-TESTED). It is a first filter only. The enforced controls are tool offering and execution-time authorization (below), tenant scoping from context, bounded iterations (4) and output judging. No semantic/LLM-based injection classifier. |
| Tool authorization | Fixed this pass (`f40dd0c`, `0803bb1`): only tools offered in the run can execute; exact-name match; non-object arguments normalised; ids come from the run context; one choke point (`ToolCallingService` is the only caller of the registry's `execute`). UNIT-TESTED (36 tests on that service, the new ones fail on the old code). Per-tool business-rule validation inside each handler was not re-reviewed line by line. |
| PII redaction in prompts | `common/privacy/pii-redaction.util.ts` exists but is not applied in the pipeline; the model sees customer text as written. Tool traces are sanitised for storage. NOT IMPLEMENTED for prompts; needs a policy decision (what may reach the provider). |
| Provider timeouts and malformed output | Call deadline in the provider (default 20 s, hard total deadline option), truncated output rejected, malformed/machine output judged by `judgeFinalAnswer`, provider errors recorded as `PROVIDER_ERROR` executions (IMPLEMENTED, UNIT-TESTED with mocked providers). Real-provider behaviour NEEDS STAGING/PROVIDER. |
| Credit accounting | Durable reservations, settlement, release on definitive rejection, hold kept on uncertain outcomes (UNIT-TESTED; concurrency primitive is the tenant row lock, REAL-DB TESTED only for the new conversation lease, not for credits). |
| Conversation concurrency | Cross-replica lease (REAL-DB TESTED, 7 tests). |
| Audit and traces | `ai_executions` row per run including errors, sanitised tool trace, link to the interaction log (IMPLEMENTED, UNIT-TESTED). |
| BullMQ on real PostgreSQL | AI learning/evaluation queues exist; their integration against real Redis + PostgreSQL has not been run in this pass. NEEDS STAGING. |

## 5. v1 retirement (summary)
v1 remains for every non-commerce tenant without `verz_ai_v2` and for the `/ai-logs/test` sandbox. Plan in `AI_AUDIT_2026-11-04.md`. Do not enable the flag for production tenants until the v2 staging validation (earlier 2 of 4 replies rejected as malformed) is repeated on this build with real provider calls.

## 6. What may be called what today
* IMPLEMENTED and UNIT-TESTED: v2 pipeline stages, tool loop, credits, injection guard, output judging, execution traces.
* REAL-DB TESTED: conversation lease; Messenger import (not AI).
* NEEDS STAGING/PROVIDER before any readiness claim: real provider replies, malformed/truncated handling against the real API, BullMQ/PostgreSQL queue behaviour, v2 vs v1 quality.
* NOT IMPLEMENTED: voice transcription, image understanding, spend caps and alerts, prompt PII redaction.
