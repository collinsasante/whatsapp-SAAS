# AI Digital Self

Every human agent has a **Digital Self**: a compact, structured description of how that agent writes, learned from the replies
they send. A business can choose an agent's Digital Self for a conversation, and Verz AI then writes in that style. It
changes **how** a reply sounds, never **what** is true: prices, stock, orders, payments and policies still come only from tools and
the knowledge base.

## Status

Built and covered by automated tests. **Not deployed, not migrated anywhere real, not tested with a live model.** The migrations
`20261030120000_ai_digital_self` and `20261030130000_digital_self_learning_exclusion` have only been applied to throwaway local
databases. The live-model check is a separate, repeatable procedure: [digital-self-staging-validation.md](digital-self-staging-validation.md).

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
non-text, templates, **saved replies** (the inbox sends the saved reply's id when it goes out unedited; the server checks the id
against the workspace's own saved replies, and as a backstop a message that is the *whole* of a saved reply or template body with its
`{{variables}}` filled in is also skipped, so a genuine reply that only resembles one is still learned), **AI-written text** an agent
sent as-is or started from, auto-replies, simulated messages, commerce AI output, messages typed on the phone app (author unknown),
and text over 2,000 characters. Automated workflows (welcome message, CSAT thank-you, chatbot flows, automations, campaigns) never
carry a human sender, so they are excluded by the sender rule.

Extracted per message (deterministic, no model, no external call): length, sentence structure, whether the reply ends on a question,
opening acknowledgement, empathy markers, exclamation/emoji/contraction use, formal and casual markers, greeting and closing type,
and lexical language markers (Pidgin, Twi, Ghanaian English, English) with code-switching. **No message text is stored.** Each event
keeps only these derived numbers, which is what makes removal exact. Sales and objection-handling behaviour is **not** learned and
nothing in the profile, the prompt or the UI claims it is.

### Conversation exclusion (privacy)

An admin, or the agent who owns the conversation, can exclude a conversation from learning (`PUT
/digital-self/conversations/:id/learning-exclusion`). It sets the flag, then removes every event taken from that conversation and
rebuilds each affected profile from the events that remain. A learner holds a shared lock on the conversation row for its whole
transaction and the exclusion write needs the exclusive lock, so a learner already running either finishes first (and is then
removed) or sees the flag; a job queued earlier re-checks when it runs. Lifting the exclusion only allows future replies; removed
evidence is not restored. Both actions are audited. The tenant flag and per-agent pause are **not** a substitute for this.

### Style corrections

An example approved in the existing review workflow contributes one weighted sample to the Digital Self assigned to its conversation
only if **every** failure category is a style category (`ROBOTIC_RESPONSE`, `TOO_VERBOSE`, `TOO_SHORT`) and it has a corrected reply.
Factual or behavioural categories, mixed ones, unapproved examples, conversations with no Digital Self and excluded conversations are
untouched and stay in the reviewed-guidance system. While applied, the example is left out of the workspace-wide guidance so one
agent's correction cannot steer the others. It does not count as the agent's own replies. Withdrawing approval or excluding the
conversation removes it exactly. Reset keeps approved corrections and business overrides.

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

`GET /` and `GET /:id` (agent+), `GET|PUT /conversations/:conversationId` and `PUT /conversations/:conversationId/learning-exclusion` (agent+; changing: admin, or the conversation's owner),
`PATCH /:id/learning`, `PATCH /:id/enabled`, `PUT /:id/overrides`, `POST /:id/reset` (admin; audited).

## Rolling out

1. Apply the migration (reviewed, with a backup) to staging first.
2. Enable the `digital_self` flag for one tenant that has authorized this use of its agents' messages.
3. Let agents reply; check the Team page shows evidence growing; assign a Digital Self to a Test Chat conversation and compare replies.

## Known limitations

- Style only; no sales or objection-handling learning (needs semantic analysis and explicit data-sharing approval).
- Learning is forward-only: existing message history is not back-filled.
- Replies a human types in the WhatsApp phone app are not learned from.
- A saved reply that an agent edits before sending counts as their own writing (they customised it); AI-written text counts as the
  AI's even if lightly edited. The server-side saved-reply match is a backstop for clients that do not send the id.
- A style correction uses the Digital Self assigned to its conversation *when it is approved*; later reassignment does not move it.
- Language and code-switching detection uses small lexicons (Pidgin, Twi, Ghanaian English) and will miss other languages.
- Exclusion takes a short shared lock on the conversation row while a learner runs; updates to that row wait for it (milliseconds).
- Preview is the existing Test Chat (real pipeline, simulated contact, never sent); it makes real model calls.
- Not tested with a live model; see the staging validation procedure.

## Verifying against real infrastructure

`digital-self.db.integration.spec.ts` runs against a real Postgres and Redis when `DIGITAL_SELF_TEST_DATABASE_URL` (and
`DIGITAL_SELF_TEST_REDIS_URL`) are set; it refuses any database that is not local and named `*test`.
