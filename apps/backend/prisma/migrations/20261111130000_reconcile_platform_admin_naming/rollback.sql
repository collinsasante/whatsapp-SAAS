-- Manual rollback for 20261111130000_reconcile_platform_admin_naming (not run by Prisma). Restores production's previous names; keeps the indexes (harmless).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_sessions_admin_id_fkey') THEN
    ALTER TABLE "admin_sessions" RENAME CONSTRAINT "admin_sessions_admin_id_fkey" TO "admin_sessions_adminId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_audit_logs_admin_id_fkey') THEN
    ALTER TABLE "platform_audit_logs" RENAME CONSTRAINT "platform_audit_logs_admin_id_fkey" TO "platform_audit_logs_adminId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = 'admin_sessions_token_hash_key') THEN
    ALTER INDEX "admin_sessions_token_hash_key" RENAME TO "admin_sessions_tokenHash_key";
  END IF;
END $$;
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111130000_reconcile_platform_admin_naming';
