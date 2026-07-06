-- Add reply tracking to campaigns so the delivery funnel can show real customer engagement
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "replied_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "replied_at" TIMESTAMP(3);
