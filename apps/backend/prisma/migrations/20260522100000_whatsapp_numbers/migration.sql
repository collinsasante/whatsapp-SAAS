-- Migration: add_whatsapp_numbers_and_conversation_fk
-- Safe: additive only — new table + nullable column, no existing rows affected
-- Rollback: DROP TABLE whatsapp_numbers; ALTER TABLE conversations DROP COLUMN whatsapp_number_id;

-- 1. Create whatsapp_numbers table
CREATE TABLE "whatsapp_numbers" (
    "id"              TEXT NOT NULL,
    "tenant_id"       TEXT NOT NULL,
    "label"           TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "waba_id"         TEXT NOT NULL,
    "access_token"    TEXT NOT NULL,
    "is_default"      BOOLEAN NOT NULL DEFAULT false,
    "is_active"       BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_numbers_pkey" PRIMARY KEY ("id")
);

-- 2. Unique constraint: one phoneNumberId per tenant
CREATE UNIQUE INDEX "whatsapp_numbers_tenant_id_phone_number_id_key"
    ON "whatsapp_numbers"("tenant_id", "phone_number_id");

-- 3. Index for tenant lookups
CREATE INDEX "whatsapp_numbers_tenant_id_idx"
    ON "whatsapp_numbers"("tenant_id");

-- 4. FK to tenants
ALTER TABLE "whatsapp_numbers"
    ADD CONSTRAINT "whatsapp_numbers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Add nullable whatsapp_number_id to conversations (no existing rows broken)
ALTER TABLE "conversations"
    ADD COLUMN "whatsapp_number_id" TEXT;

-- 6. Index for the new FK column
CREATE INDEX "conversations_whatsapp_number_id_idx"
    ON "conversations"("whatsapp_number_id");

-- 7. FK: conversations → whatsapp_numbers (SET NULL keeps old rows safe)
ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_whatsapp_number_id_fkey"
    FOREIGN KEY ("whatsapp_number_id") REFERENCES "whatsapp_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. Seed: copy existing tenant WhatsApp credentials into whatsapp_numbers as the default number
--    Only runs for tenants that have all three fields set (phone_number_id, waba_id, access_token).
--    Existing tenants without these fields are skipped safely.
INSERT INTO "whatsapp_numbers" ("id", "tenant_id", "label", "phone_number_id", "waba_id", "access_token", "is_default", "is_active", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    id,
    'Default',
    phone_number_id,
    waba_id,
    access_token,
    true,
    true,
    NOW(),
    NOW()
FROM "tenants"
WHERE phone_number_id IS NOT NULL
  AND waba_id IS NOT NULL
  AND access_token IS NOT NULL
ON CONFLICT ("tenant_id", "phone_number_id") DO NOTHING;
