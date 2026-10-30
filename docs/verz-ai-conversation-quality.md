# Verz AI conversation quality

Phase 1 of the conversation-quality work: fixes to what the model is given and to what a customer can receive. It changes no
prompt and no style block (Phase 2), and no credit, takeover or tenant-isolation code.

## Which generator answers a message

| Generator | Used when |
| --- | --- |
| Legacy responder (`ai/ai-responder.service.ts`) | Default for workspaces without commerce, while the `verz_ai_v2` flag is off |
| v2 pipeline (`ai-core/pipeline`) | `verz_ai_v2` flag on |
| Commerce AI (`commerce/ai`) | The workspace has commerce enabled |

All three now share the same history selection, knowledge-base ranking, injection guard and output checks.

## What Phase 1 changed

1. **History is built around the stored inbound message, by id** (`ai-core/context/history-select.util.ts`, `history-loader.util.ts`).
   Before, the newest stored row was assumed to be the message being answered and was dropped with `slice(0, -1)`. With quick
   fragments, or a welcome message stored just after the inbound, the model saw the answered message twice and lost its own latest
   reply. Now the message itself is never in the history, customer messages that arrived after it (by the query's own
   `createdAt, id` order) are left out because each is answered in its own turn, and replies stored after it are kept.
   Callers with no stored message (the test sandbox) keep the old rule.
2. **Knowledge-base ranking** (`knowledge-base/knowledge-retrieval.util.ts`): stop words and chat filler (including Ghanaian chat
   words) carry no weight; a light stemmer; a small synonym table ("momo" and "mobile money", "cost" and "price", "deliver" and
   "shipping"); rare terms count for more (inverse document frequency) and a title hit counts more than a body hit; "where" and
   "what time" map to Location and Opening hours; a greeting, thanks or an emoji retrieves nothing; a thin follow-up ("and the 500g?")
   borrows its subject, at lower weight, from the customer's own last two messages; and a large knowledge base returns nothing
   when nothing matches instead of five unrelated articles. A knowledge base of five articles or fewer is still sent whole.
3. **Injection guard** (`ai-core/guards/injection-patterns.ts`): one list for all three generators (the legacy responder used a
   private, broader copy). "give me the phone number of the shop", "give me the user guide" and "you are now a bit late with my
   order" are no longer treated as attacks; requests for other customers' data in bulk, a new persona or mode, and database exports
   are still blocked.
4. **Model output is checked before a customer can see it** (`ai-core/completion/model-output.util.ts`): cut-off or malformed JSON,
   provider error bodies, HTML, stack traces, tokens and over-long text are never sent. A complete reply in JSON missing only a closing
   brace is recovered. A rejected output takes the existing recovery path: legacy sends nothing and the caller does a real handoff
   with the standard fallback text; v2 and Commerce use the provider-failure fallback and `shouldEscalate`.
5. **Human requests**: far more natural and informal phrasing is detected, including "I need to talk to someone", "abeg make I talk to
   somebody", "can someone call me". The legacy responder had no detection at all; it now hands off for real (and skips a paid model
   call), as v2 and Commerce already did. Detection sets `shouldEscalate`; `MessagesService` performs the handoff with a retry and
   replaces the reply with an honest message if the handoff fails.

## Tests

- **Unit and evaluation suite (mocked database and provider, real production classes):** `pnpm --filter backend test`.
  `src/ai-core/quality` runs 66 scenarios through the legacy, v2 and Commerce generators (184 cases): greetings and thanks, quick
  bursts, follow-ups, Ghanaian business questions, competing knowledge-base matches, requests the guard used to block, real attacks,
  malformed and truncated model output, requests for a person, and tenant and conversation isolation. Requests for a person on the
  legacy responder are decided in `MessagesService`, so they are tested through its real handlers instead (below).
- **Real PostgreSQL:** `test/ai-history.e2e-spec.ts`. Needs `DATABASE_URL` to a disposable, migrated database (see
  `.env.test.example`): `pnpm test:e2e -- ai-history`. Covers ordering, same-millisecond ties, 8 concurrent writes answered one at a
  time, the v2 stage, the legacy responder, Commerce, tenant isolation and knowledge-base ranking on real rows.
- Human-request handoff through the real handlers: `messages/messages.service.spec.ts`.

## What this does not prove

None of this calls a model. It shows what the model is given and what the customer receives from a given model output. It does
not show how natural a real model's wording is; the prompts are unchanged, so the canned "That's a great question! Our team will
follow up with you shortly." fallback and the "address the customer by name" rule still exist. Those are Phase 2, and they need
live replies to evaluate.
