-- Add whatsapp_call_id to call_logs for tracking Meta API call IDs
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "whatsapp_call_id" TEXT;
