-- Additive, nullable, no default: metadata-only on PostgreSQL (no table rewrite, no lock beyond a brief ACCESS EXCLUSIVE).
-- Durable idempotency for campaign sending. A worker claims a recipient (claimed_at, claim_token) before calling Meta and records the
-- WhatsApp message id (whatsapp_message_id) the moment Meta accepts it, so a crash or a retried job can never send the same recipient twice.
-- `status` is unchanged (a claimed recipient stays PENDING), so counters, completion and the UI are unaffected.
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP(3);
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "claim_token" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "whatsapp_message_id" TEXT;
