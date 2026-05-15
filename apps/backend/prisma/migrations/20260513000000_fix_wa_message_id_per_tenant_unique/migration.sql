-- Fix: replace global unique on whatsapp_message_id with per-tenant unique.
-- Root cause: two tenants sharing the same WhatsApp phone number would fail to
-- both store the same inbound message because the old constraint was global.

-- Drop the old global unique index
DROP INDEX IF EXISTS "messages_whatsapp_message_id_key";

-- Create per-tenant unique index (NULL values are treated as distinct in Postgres,
-- so multiple outbound pending messages with NULL whatsapp_message_id are fine)
CREATE UNIQUE INDEX "messages_tenant_id_whatsapp_message_id_key"
  ON "messages" ("tenant_id", "whatsapp_message_id")
  WHERE "whatsapp_message_id" IS NOT NULL;
