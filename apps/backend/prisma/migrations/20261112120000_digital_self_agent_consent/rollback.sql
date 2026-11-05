-- Manual rollback for 20261112120000_digital_self_agent_consent (not run by Prisma). Removes recorded consent decisions; profiles and events are untouched.
ALTER TABLE "digital_selves" DROP CONSTRAINT IF EXISTS "digital_selves_consent_by_self_chk";
ALTER TABLE "digital_selves" DROP COLUMN IF EXISTS "consent_decided_by_id", DROP COLUMN IF EXISTS "consent_decided_at", DROP COLUMN IF EXISTS "consent_version", DROP COLUMN IF EXISTS "consent_status";
DROP TYPE IF EXISTS "DigitalSelfConsentStatus";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112120000_digital_self_agent_consent';
