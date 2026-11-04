DROP TABLE IF EXISTS "message_enrichments";
ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "voice_transcription_enabled";
ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "image_understanding_enabled";
