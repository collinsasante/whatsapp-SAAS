-- Persists the "learn from conversations" throttle so it survives backend
-- restarts/deploys instead of resetting via an in-memory Map. Nullable,
-- additive, no backfill needed (null = "never learned yet", same as today).
ALTER TABLE "tenant_settings" ADD COLUMN "last_kb_learn_at" TIMESTAMP(3);
