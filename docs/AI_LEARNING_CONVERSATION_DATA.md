# Real conversations for AI evaluation: handling rules and the export tool

Status: the export tool is built and tested. **No production conversation has been exported.** Nothing here authorises a
production read or any downstream use of customer messages; that needs the approvals listed in section 2.

## 1. What exists

| Piece | Where | State |
|---|---|---|
| PII and secret redaction | `apps/backend/src/common/privacy/pii-redaction.util.ts` | Built, tested. A safety net, not anonymisation (section 4). |
| Dataset builder: roles, pseudonyms, split, exclusions | `apps/backend/src/ai-learning/dataset/dataset-builder.util.ts` | Built, tested. |
| Export tool (dry run, write, resume, purge) | `.../dataset/conversation-export.service.ts` and `.cli.ts` | Built, tested, including against a real PostgreSQL. |
| Review gate on the existing KB learning | `knowledge-base.service.ts` | Learned articles are now created inactive and redacted. |
| Candidate store with review, versioning, approval and deletion | not built | Needs new tables (a reviewed migration). |
| Live evaluation on the exported data | not run | Needs a staging-only provider key and approval. |

## 2. Approvals needed before real data is used (none of this is assumed)

1. **Written authorisation for this use.** The data belongs to your customers' customers and sits under each tenant. Confirm that your
   terms and privacy notice permit using their conversations to improve the AI, which tenants are in scope, and for how long. Record the
   decision as an approval reference; the tool requires it as `--approval-id` for any write.
2. **A read-only database role** for the export (section 3). Do not use the application's own credentials.
3. **A storage location** outside any Git repository, with owner-only access, and a named person who may open it.
4. **Where the data may go next.** This tool never sends anything anywhere. Do not send exported text to an external model provider, use
   it for fine-tuning, or copy it into staging until that is approved separately. The existing KB "learn" feature already sends
   (now redacted) text to the provider; keep it off (`KB_LEARNING_DISABLED` unset) unless that use is approved.

## 3. Running it

Create a role that can only read, once, on the production database (run by the database owner):

```sql
CREATE ROLE dataset_export LOGIN PASSWORD '<generated, kept in your secret store>';
GRANT CONNECT ON DATABASE <db> TO dataset_export;
GRANT USAGE ON SCHEMA public TO dataset_export;
GRANT SELECT ON conversations, messages, contacts, users, ai_interaction_evaluations TO dataset_export;
```

Dry run first (prints counts only; writes nothing; needs no key):

```bash
EXPORT_DATABASE_URL='postgresql://dataset_export:...@host/db' \
  npm run dataset:export -- --tenant-id <tenant> --from 2026-10-01 --to 2026-10-15 --limit 200
```

Write (only with the approval in hand). Use the same `DATASET_PSEUDONYM_KEY` every time for one dataset; keep it in the secret store, never
beside the data:

```bash
EXPORT_DATABASE_URL=... DATASET_PSEUDONYM_KEY=... \
  npm run dataset:export -- --tenant-id <tenant> --from ... --to ... --limit 200 --write \
  --out-dir /secure/dataset/<export-id> --approval-id <approval-reference>
```

Bounds, enforced before any read: one tenant per run, a window of at most 92 days, at most 2000 conversations (the limit counts every run
of the same export together), pages of at most 200, an absolute output path that is not inside a Git work tree, and a key of at least 32
characters. Reads happen in a transaction the database marks READ ONLY, ordered by (updated time, id), so a stopped run resumes where it
stopped and never exports a conversation twice.

## 4. What is in the data

One JSON record per conversation (`schemaVersion` 1), with:
- keyed pseudonyms for the conversation and the tenant (not reversible without the key), the month of the first message, and turn times
  as seconds since the first turn; no tenant id, conversation id, phone number, contact name, e-mail or absolute timestamp;
- each text turn labelled `customer`, `ai`, `human_agent` or `system` (automation: templates, flows, campaigns), redacted;
- `humanAnswerTurns`: the indexes of turns a human wrote. **Only these may be treated as a correct answer.** AI turns are what is being
  judged and are never ground truth;
- outcome signals: AI and human turn counts, whether a human took over after the AI, and a summary of any AI evaluations (lowest score,
  needs-review, customer correction, failure categories). "Not evaluated" is recorded as not evaluated, never as good;
- `split`: `dev` (may be used to generate candidate answers) or `heldout` (about 30%, decided from the pseudonym so a conversation never
  switches side): only for the final comparison, never for generating candidates. This is the separation that prevents evaluation leakage.

Excluded and counted by reason: Test Chat conversations (reserved number range or simulated marker), evaluation contacts, conversations
with no customer message, one-turn conversations, and duplicates. Nothing is filtered by outcome, so good and bad AI conversations, and
human takeovers, are all included.

Redaction replaces e-mails, URLs (payment links), tokens and keys, Luhn-valid card numbers, Ghana Card ids, phone-like and long digit
runs, and the contact's and agents' names with `[EMAIL]`, `[URL]`, `[TOKEN]`, `[CARD]`, `[ID]`, `[PHONE]`, `[NUMBER]`, `[NAME]`. It is
biased towards over-redaction. **It does not find** names that were not supplied (a third person mentioned in a message), street
addresses, or personal facts in prose. Treat exported text as personal data with a lower risk, not as anonymous, and review a sample
before any wider use.

## 5. Storage, retention and deletion

- Location: a directory you choose outside any repository, mode 0700, files 0600. The tool refuses a location inside a Git work tree.
  It contains `data.jsonl`, `manifest.json` (counts, window, approval reference, redaction version; no content), `cursor.json` (resume
  state; this one holds a raw conversation id and is deleted with the data) and `exported-refs.txt`.
- Never commit it. Never copy it to a laptop, a chat, a ticket or a shared drive.
- Retention: set it with the approval. The tool does not delete on a timer. Recommended: delete when the evaluation round that used it is
  finished, and no later than the approved date.
- Deletion: `npm run dataset:export -- --purge <export-id> --out-dir /secure/dataset/<export-id>` removes the data, refs and cursor,
  verifies the manifest names that export first, and leaves the manifest with a purge record. Also delete any copy made elsewhere, and
  securely remove the directory itself if the disk is not encrypted.
- Limitations: an interrupted write can leave a conversation in `data.jsonl` that is not yet in `exported-refs.txt`, so a resume may write
  it twice; de-duplicate on `conversationRef` when reading. Deleting a file does not erase it from backups of the host.

## 6. What still has to be built or decided

- **A candidate store** (generated answers or knowledge items, with source, version, review status, approval, rejection and deletion,
  tenant-scoped, with an audit trail that holds no message text). It needs a reviewed migration; nothing generates or promotes
  candidates automatically today, and the existing KB learning now stops at "inactive, awaiting review".
- **The evaluation run** on the `dev` and `heldout` splits against the baseline prompt, using a staging-only provider key and the usage
  caps, with the dataset version, prompt version, model, usage and results recorded. No prompt or knowledge change goes live without your
  explicit approval.
- **A decision on the real-traffic judge spend cap** and on durable judge usage records (see the progress document).
