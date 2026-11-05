-- Rollback for 20261111120000_whatsapp_webhook_signature_registry. Not run by Prisma (it is not named migration.sql); apply by hand only after the
-- code that reads these tables is no longer deployed. Drops the registered app secrets (encrypted), the WABA mappings and the signature counters.
DROP TABLE IF EXISTS "whatsapp_waba_apps";
DROP TABLE IF EXISTS "whatsapp_meta_apps";
DROP TABLE IF EXISTS "whatsapp_webhook_signature_stats";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111120000_whatsapp_webhook_signature_registry';
