-- Additive: progress/checkpoint table for importing a Page's existing Messenger conversations. No existing table or column is changed.
DO $$ BEGIN
  CREATE TYPE "ChannelHistorySyncStatus" AS ENUM ('PENDING', 'SYNCING', 'COMPLETED', 'PARTIAL', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "channel_history_syncs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'MESSENGER',
    "status" "ChannelHistorySyncStatus" NOT NULL DEFAULT 'PENDING',
    "correlation_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "cursor" TEXT,
    "watermark" TIMESTAMP(3),
    "pending_watermark" TIMESTAMP(3),
    "conversations_discovered" INTEGER NOT NULL DEFAULT 0,
    "conversations_imported" INTEGER NOT NULL DEFAULT 0,
    "conversations_skipped" INTEGER NOT NULL DEFAULT 0,
    "conversations_failed" INTEGER NOT NULL DEFAULT 0,
    "messages_discovered" INTEGER NOT NULL DEFAULT 0,
    "messages_imported" INTEGER NOT NULL DEFAULT 0,
    "messages_skipped" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" INTEGER,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channel_history_syncs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "channel_history_syncs_channel_id_key" ON "channel_history_syncs"("channel_id");
CREATE INDEX IF NOT EXISTS "channel_history_syncs_tenant_id_idx" ON "channel_history_syncs"("tenant_id");
DO $$ BEGIN
  ALTER TABLE "channel_history_syncs" ADD CONSTRAINT "channel_history_syncs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "channel_history_syncs" ADD CONSTRAINT "channel_history_syncs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
