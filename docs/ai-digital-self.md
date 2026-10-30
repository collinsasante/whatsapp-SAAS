# AI Digital Self

Every human agent has a **Digital Self**: a compact, structured description of how that agent writes, learned from the replies
they send. A business can choose an agent's Digital Self for a conversation, and Verz AI then writes in that style. It
changes **how** a reply sounds, never **what** is true: prices, stock, orders, payments and policies still come only from tools and
the knowledge base.

## Status

Built and covered by automated tests. **Not deployed, not migrated anywhere real, not tested with a live model.** The migration
`20261030120000_ai_digital_self` has only been applied to a throwaway local database.

## How it works

| Piece | Where |
| --- | --- |
| Data model | `DigitalSelf`, `DigitalSelfLearningEvent`, `Conversation.digitalSelfId` (additive migration) |
| Provisioning | Migration backfills existing ADMIN/AGENT users; new users get one in the same transaction (`users.service`, invite acceptance); `DigitalSelfService.ensureForTenant` is a lazy backstop on list/learn/assign |
| Learning | `MessagesService.sendMessage` queues the sent text reply on `digital-self-learn`; `DigitalSelfLearningProcessor` runs in the backend process |
| Profile | Versioned JSON of counters (`profile.util.ts`), windowed to the last 200 replies; the readable summary is derived on read and only for traits with at least 10 replies behind them |
| Assignment | `PUT /digital-self/conversations/:id` writes **only** `Conversation.digitalSelfId` |
| AI use | `DigitalSelfContextService.getStyleBlock` is read by the commerce AI, the legacy responder and the v2 context-assembly stage |
| UI | Team page section (admins), picker in the conversation header and on Test Chat |

### What is learned from, and what is not

Only a human agent's own typed text reply. Excluded: AI replies (sender is the `isAiAgent` user or null), customer messages,
non-text, templates, saved (canned) replies pasted verbatim, auto-replies, simulated messages, commerce AI output, messages
typed on the phone app (`source: external`, author unknown), and text over 2,000 characters.

Extracted per message (deterministic, no model, no external call): word count, question/exclamation/emoji/contraction use,
formal and casual register markers, greeting and closing type, and lexical language markers (Pidgin, Twi, Ghanaian English,
English). **No message text is stored**, only counters. Sales and objection-handling behaviour is **not** learned yet; the profile
has a `v` field so a future semantic pass can add it.

### Lifecycle

`INITIALIZING` (nothing learned) -> `LEARNING` -> `READY` (30+ replies; not a quality claim) -> `NEEDS_MORE_EXAMPLES` (below 30 and
idle 30 days). `PAUSED` when learning is paused or the Digital Self is deactivated. Status is derived at read time.

## Safety properties

- **Off by default.** Learning and using a style require the feature flag `digital_self` for the tenant (same mechanism as
  `ai_learning_system`). Profiles are still created for every agent. With the flag off the AI prompt is byte-identical to before.
- **Tenant isolation.** Every query includes the authenticated tenant; background jobs re-read the message by `{id, tenantId}`.
- **Human control.** Assigning a Digital Self never changes `assignedToId` and never turns AI replies on. Takeover/handoff code
  is untouched.
- **Fallback.** Any failure, missing profile, deactivated Digital Self, or inactive/suspended agent yields an empty style block.
- **Prompt safety.** The block is generated from counters and fixed vocabulary only (no free text from agents or admins), is
  placed before the safety guardrails, and states that it cannot change facts.
- **Concurrency.** The ledger row and profile update commit together under a row lock; admin edits take the same lock.

## API (all under `/api/v1/digital-self`)

`GET /` and `GET /:id` (agent+), `GET|PUT /conversations/:conversationId` (agent+; assigning: admin, or the conversation's owner),
`PATCH /:id/learning`, `PATCH /:id/enabled`, `PUT /:id/overrides`, `POST /:id/reset` (admin; audited).

## Rolling out

1. Apply the migration (reviewed, with a backup) to staging first.
2. Enable the `digital_self` flag for one tenant that has authorized this use of its agents' messages.
3. Let agents reply; check the Team page shows evidence growing; assign a Digital Self to a Test Chat conversation and compare replies.

## Known limitations

- Style only; no sales or objection-handling learning (needs semantic analysis and explicit data-sharing approval).
- Learning is forward-only: existing message history is not back-filled.
- No conversation-level "private/excluded" marker exists in the schema, so none is honoured; the tenant flag and per-agent
  pause are the controls.
- Saved-reply detection is an exact text match, so a saved reply with filled-in variables can be counted.
- Replies a human types in the WhatsApp phone app are not learned from.
- Preview is the existing Test Chat (real pipeline, simulated contact, never sent); it makes real model calls.
- Corrections feedback is not yet routed into Digital Self profiles; style corrections are made on the Team page.

## Verifying against real infrastructure

`digital-self.db.integration.spec.ts` runs against a real Postgres and Redis when `DIGITAL_SELF_TEST_DATABASE_URL` (and
`DIGITAL_SELF_TEST_REDIS_URL`) are set; it refuses any database that is not local and named `*test`.
