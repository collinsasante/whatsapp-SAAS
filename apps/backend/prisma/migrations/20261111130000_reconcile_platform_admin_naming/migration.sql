-- Brings production's platform-admin tables in line with schema.prisma and with staging. Additive or metadata-only, and idempotent: every statement is
-- guarded, so it is a no-op wherever the target already exists (staging and a fresh build already have all of this).
--
-- Found by applying the integration branch's migrations to a restored copy of the production backup and diffing the result against schema.prisma: production's
-- admin_sessions and platform_audit_logs were created by hand with camelCase constraint and index names and without three indexes. Nothing is dropped and no
-- data is rewritten. The remaining, deliberately untouched drift is frozen in prisma/schema-drift-baseline.json; see docs/SCHEMA_DRIFT.md.

-- Missing indexes (production's platform_audit_logs has 21 rows, so the build is instantaneous).
CREATE INDEX IF NOT EXISTS "platform_audit_logs_admin_id_idx" ON "platform_audit_logs"("admin_id");
CREATE INDEX IF NOT EXISTS "platform_audit_logs_action_idx" ON "platform_audit_logs"("action");
CREATE INDEX IF NOT EXISTS "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");

-- Renames: catalogue-only operations, applied only when the old name exists and the new one does not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_sessions_adminId_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_sessions_admin_id_fkey') THEN
    ALTER TABLE "admin_sessions" RENAME CONSTRAINT "admin_sessions_adminId_fkey" TO "admin_sessions_admin_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_audit_logs_adminId_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_audit_logs_admin_id_fkey') THEN
    ALTER TABLE "platform_audit_logs" RENAME CONSTRAINT "platform_audit_logs_adminId_fkey" TO "platform_audit_logs_admin_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = 'admin_sessions_tokenHash_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = 'admin_sessions_token_hash_key') THEN
    ALTER INDEX "admin_sessions_tokenHash_key" RENAME TO "admin_sessions_token_hash_key";
  END IF;
END $$;
