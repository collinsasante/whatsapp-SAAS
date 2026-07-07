-- Real WhatsApp Cloud API error codes (previously only a generic exception message was stored)
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "error_code" INTEGER;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "error_code" INTEGER;

-- Persisted WhatsApp number quality/tier (previously fetched live from Meta and discarded)
ALTER TABLE "whatsapp_numbers" ADD COLUMN IF NOT EXISTS "quality_rating" TEXT;
ALTER TABLE "whatsapp_numbers" ADD COLUMN IF NOT EXISTS "messaging_limit_tier" TEXT;
ALTER TABLE "whatsapp_numbers" ADD COLUMN IF NOT EXISTS "quality_synced_at" TIMESTAMP(3);

-- Opt-out/block history (previously booleans with no timestamp, so no trend was possible)
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "blocked_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "opted_out_at" TIMESTAMP(3);
