# Review of the four pending migrations (2026-11-04)

Scope: `20261104120000_channel_history_sync`, `20261105120000_ai_conversation_leases` `20261106120000_ai_daily_credit_cap` and (added 2026-11-04, later) `20261107120000_tiktok_publications`, on `integration/staging-candidate-v2`. Verified locally against a real PostgreSQL 17 (the servers run 16): nothing was applied to staging or production.

## What they do
| Migration | Changes |
|---|---|
| `20261104120000_channel_history_sync` | creates enum `ChannelHistorySyncStatus` (inside a `DO` block that tolerates "already exists"), table `channel_history_syncs`, a unique index on `channel_id`, an index on `tenant_id`, and foreign keys to `tenants(id)` and `channels(id)` with `ON DELETE CASCADE` |
| `20261105120000_ai_conversation_leases` | creates table `ai_conversation_leases` (primary key `conversation_id`) and an index on `expires_at`; **no foreign keys on purpose** |
| `20261106120000_ai_daily_credit_cap` | `ALTER TABLE tenant_settings ADD COLUMN ai_daily_credit_cap INTEGER` (nullable, no default: metadata-only, no table rewrite) and a `CHECK (cap IS NULL OR cap >= 0)` constraint (validated by scanning `tenant_settings`, one row per workspace, so effectively instant). It takes a brief ACCESS EXCLUSIVE lock on `tenant_settings`: if a long transaction holds that table the statement waits and queues new readers behind it, so apply it when no long-running transaction is open (the release script stops the staging writers first). Existing rows keep every value and get a NULL cap (no cap). Rollback: drop the constraint, then the column; the cap values are the only data lost. |
| `20261107120000_tiktok_publications` | Creates the enum `TikTokPublishStatus` and the table `tiktok_publications` (unique `(tenant_id, idempotency_key)`, indexes on `(status, next_attempt_at)` and `(tenant_id, created_at)`, foreign keys to `tenants` and `channels` with ON DELETE CASCADE). Nothing existing is altered: no lock on a populated table, nothing to backfill. Statements are guarded (`IF NOT EXISTS`, `duplicate_object`) so a re-run is harmless. Verified: applies on the full history, and `prisma migrate diff` reports no drift for the new table. Rollback: `DROP TABLE tiktok_publications; DROP TYPE "TikTokPublishStatus";` (loses only publishing history). Inert until the `tiktok_publishing` feature flag is created and enabled: no flag row means disabled. |
The first two alter nothing that exists. The third is the only one that touches an existing table. All statements use `IF NOT EXISTS` or tolerant `DO` blocks, so a manual re-run is harmless (tested).

## Verification performed
* Full 101-migration history on a blank database via the repo's own `prisma migrate deploy`: applied; `migrate status` up to date.
* Incremental: with everything applied except these two (their tables, type and history rows removed), `migrate deploy` applies exactly these two, in order.
* Idempotent: each SQL file run a second time with `ON_ERROR_STOP` succeeds.
* Rollback SQL (`DROP TABLE ai_conversation_leases; DROP TABLE channel_history_syncs; DROP TYPE "ChannelHistorySyncStatus";`) succeeds.
* Staging gate preflight (read-only, 2026-11-04): 98 migrations applied there, all present in the candidate with identical checksums, exactly these pending (the third was added after that preflight and must be re-checked the same way before deploy).
* Both real-database suites (Messenger import, AI lease) run against a schema built from `schema.prisma` and pass.

## Locking and data safety
* The tables are new and empty, so there is no table rewrite and no long lock.
* The two foreign keys in the first migration take a brief `SHARE ROW EXCLUSIVE` lock on `tenants` and `channels` while the constraints are added. Because the new table is empty, validation is instantaneous; the lock is held for milliseconds and only blocks concurrent writes to those two tables for that moment.
* `prisma migrate deploy` runs each migration in a transaction, so a failure leaves nothing half-applied.
* `ON DELETE CASCADE` on `channel_history_syncs` removes a channel's sync row with the channel; it never deletes messages or conversations. `ai_conversation_leases` has no foreign key, so a lease can never block deleting a conversation or tenant; stale rows expire and are overwritten on the next acquire.
* The sync table stores counts, cursors, timestamps and sanitised error text only; no message content or tokens.

## Rollback limits
* Dropping the tables loses only progress metadata; a later import is idempotent, so nothing is lost or duplicated. Imported messages and conversations are ordinary rows and stay.
* Older application code ignores the new tables (Prisma only touches models it knows), so a code-only rollback against the migrated schema is safe, as with the earlier additive migrations.
* The release script's code-only rollback does not drop these tables; dropping them is a deliberate, separate step.

## Compatibility
* **Staging (actual schema):** compatible; see the gate preflight.
* **Production:** these two migrations are additive and independent of the rest of the production lineage. A production release will apply **every** migration production has not yet applied (the 103-commit lineage of the deployed staging release carries several more, for example the Digital Self and AI learning migrations), not only these two. That set was not inspected on production in this pass (no server access); list production's applied migrations read-only before proposing a production release.
* **Prisma client:** adding the relation fields `Channel.historySync` and `Tenant.channelHistorySyncs` creates no columns.

## Pre-existing schema drift (separate from these migrations)
`prisma migrate diff --from <database built by all migrations> --to-schema-datamodel schema.prisma` reports differences in **24 tables** that exist independently of this work: `ai_interaction_logs, ai_knowledge_gaps, analytics_daily_conversation_stats, analytics_daily_message_stats, analytics_daily_revenue_stats, call_logs, call_notes, campaign_clicks, canned_responses, channels, chatbot_flows, contact_segments, conversation_events, conversations, feature_flags, knowledge_base_chunks, messages, platform_admins, platform_settings, subscriptions, tenant_settings, tenants, webhooks, workspace_members` (column defaults, types and some columns present only in the database), and two tables that migrations create but `schema.prisma` does not declare: **`ai_knowledge_gaps` and `knowledge_base_chunks`** (pgvector/raw-SQL managed). Nothing in the drift mentions `channel_history_syncs` or `ai_conversation_leases`.
**Operational rule that follows:** never run `prisma db push` or `prisma migrate dev` against staging or production; either would try to reconcile this drift and could drop the two undeclared tables. Use `prisma migrate deploy` only (the release script does). Reconciling the drift is a separate piece of work.
