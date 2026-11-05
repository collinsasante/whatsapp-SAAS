-- Removes only what 20261110120000_campaign_recipient_claims added. Apply after the worker code that uses these columns is rolled back.
-- Loses: the claim markers and the recorded WhatsApp message ids of recipients not yet linked to a message row.
ALTER TABLE "campaign_recipients" DROP COLUMN IF EXISTS "whatsapp_message_id";
ALTER TABLE "campaign_recipients" DROP COLUMN IF EXISTS "claim_token";
ALTER TABLE "campaign_recipients" DROP COLUMN IF EXISTS "claimed_at";
