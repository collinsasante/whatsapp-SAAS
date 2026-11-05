# Schema drift: what it is, what was done, what is frozen

`prisma migrate diff` from a database built **only** from the tracked migrations to `apps/backend/prisma/schema.prisma` proposes 35 statements. They were measured on 2026-11-05 on three real states: a fresh migration build, a restored copy of the production backup with every release migration applied, and the live staging catalog.

## The decision

**Nothing is dropped.** The three databases disagree with the schema *and with each other*, and most proposed statements are DROPs of legacy objects that hold data in at least one real database:

| Where | Evidence |
|---|---|
| staging | `knowledge_base_chunks` holds 630 pgvector chunks (the hybrid-retrieval store); `ai_interaction_logs` carries seven legacy verification columns of history |
| production | the same seven `ai_interaction_logs` columns (4,890 rows), five legacy `tenant_settings` columns, `knowledge_base_chunks` and `ai_knowledge_gaps` (0 rows) |
| production only | five foreign keys, three indexes and four columns that staging and a fresh build have are **absent**; `tenants.plan` defaults to `free` (staging and fresh: `starter`) |

This is the same stance as the earlier fix `6c139f8` (July): additive only, destructive and rename-like proposals left out until someone inspects the data.

## What changed

1. **Migration `20261111130000_reconcile_platform_admin_naming`** (additive or metadata-only, idempotent, with a manual rollback script). Found by applying the branch's migrations to the restored production copy: production's `admin_sessions` and `platform_audit_logs` were created by hand, with camelCase constraint and index names and without three indexes. It adds `platform_audit_logs_{admin_id,action,created_at}_idx` and renames two foreign keys and one index, only where the old name exists and the new one does not. A no-op on staging and on a fresh build (verified: re-running it applies nothing; the fresh-build drift stays at 35).
2. **`prisma/schema-drift-baseline.json`** freezes the remaining 35 statements, each with a class and the reason it is not applied.
3. **`src/prisma/schema-drift.db.spec.ts`** fails the build on any NEW drift (someone changed the schema or a migration without the other: the original cause) and on any frozen statement that disappears (remove it from the baseline). Wired into `backend-tests.yml` with its own throwaway database. Mutation-checked in both directions.

## Verification on a restored production backup

`waplatform_20261105_020002` restored in an isolated container (internal network, no published ports): 0 restore errors; migrations 98 to 110; every business row count identical before and after (tenants 12, messages 243,559, contacts 180,780, ai_interaction_logs 4,890). Drift against the schema: **before** the new migration 20 statements (14 shared with the baseline plus 6 production-only); **after** it 14, all inside the frozen baseline.

## The frozen statements by class

| Class | Count | Meaning |
|---|---|---|
| DEFAULT_OR_TYPE | 9 | column defaults or timestamp types; no functional effect |
| FK_SEMANTICS | 6 | three foreign keys, each reported as a drop and a re-add (production lacks them; `call_logs.contact_id` is RESTRICT in the database but SET NULL in the schema). **Owner decision**: changing it alters delete behaviour |
| LEGACY_INDEX | 6 | indexes the schema does not declare; performance only |
| LEGACY_TABLE | 5 | `ai_knowledge_gaps` and `knowledge_base_chunks` and their foreign keys |
| LEGACY_COLUMN | 4 | including a duplicate snake_case `rollout_type` next to `"rolloutType"` |
| LEGACY_CONSTRAINT | 2 | foreign keys on relations the schema does not model |
| LEGACY_COLUMNS_WITH_DATA | 2 | `ai_interaction_logs` (7 columns) and `tenant_settings` (5 columns) |
| NOT_EXPRESSIBLE | 1 | `messages (tenant_id, whatsapp_message_id)` exists everywhere as a **partial** unique index; Prisma cannot express it, so it always reports it |

## Next, when someone is ready to reconcile for real

For each class: declare the object in the schema (`@ignore` for legacy columns, `@@ignore` for legacy tables) so the schema describes the database, rather than deleting it. The foreign-key semantics need a product decision first. After each change, delete the matching entry from the baseline: the guard enforces that.
