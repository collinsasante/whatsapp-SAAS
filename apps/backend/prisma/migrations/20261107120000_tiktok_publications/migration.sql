-- Additive: one new enum and one new table (with foreign keys to existing tables). No existing table or column is changed.
DO $$ BEGIN
  CREATE TYPE "TikTokPublishStatus" AS ENUM ('QUEUED', 'UPLOADING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'UNCERTAIN', 'NEEDS_RECONNECT', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "tiktok_publications" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "created_by_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "status" "TikTokPublishStatus" NOT NULL DEFAULT 'QUEUED',
  "caption" TEXT NOT NULL,
  "privacy_level" TEXT NOT NULL,
  "media_key" TEXT NOT NULL,
  "media_size" INTEGER,
  "publish_id" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "last_error" TEXT,
  "tiktok_post_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tiktok_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_publications_tenant_id_idempotency_key_key" ON "tiktok_publications"("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "tiktok_publications_status_next_attempt_at_idx" ON "tiktok_publications"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "tiktok_publications_tenant_id_created_at_idx" ON "tiktok_publications"("tenant_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "tiktok_publications" ADD CONSTRAINT "tiktok_publications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "tiktok_publications" ADD CONSTRAINT "tiktok_publications_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
