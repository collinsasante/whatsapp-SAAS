-- Adds MESSENGER as a WebhookEvent source, so the new Messenger webhook
-- receiver can log through the same WebhookEventService monitoring path
-- WhatsApp/billing webhooks already use.
ALTER TYPE "WebhookSource" ADD VALUE 'MESSENGER';
