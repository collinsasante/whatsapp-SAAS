-- Additive: two boolean columns with a constant default on tenant_settings (metadata-only on PostgreSQL 11+, no rewrite) and one new table.
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "voice_transcription_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "image_understanding_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "message_enrichments" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "text" TEXT,
  "language" TEXT,
  "duration_sec" DOUBLE PRECISION,
  "provider" TEXT,
  "model" TEXT,
  "error_code" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "credits_charged" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "message_enrichments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "message_enrichments_message_id_kind_key" ON "message_enrichments"("message_id", "kind");
CREATE INDEX IF NOT EXISTS "message_enrichments_status_next_attempt_at_idx" ON "message_enrichments"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "message_enrichments_tenant_id_created_at_idx" ON "message_enrichments"("tenant_id", "created_at");
DO $$ BEGIN
  ALTER TABLE "message_enrichments" ADD CONSTRAINT "message_enrichments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "message_enrichments" ADD CONSTRAINT "message_enrichments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
