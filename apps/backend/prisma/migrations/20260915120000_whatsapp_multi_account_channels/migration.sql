-- WhatsApp as a multi-account Channel: schema additions + backward-compat backfill.
-- Purely additive: no columns dropped, no data destroyed. Safe to run against a live
-- production database with existing tenants, WhatsAppNumber rows, Channel rows, and
-- conversations/messages in any combination.

-- ─── Schema: link WhatsAppNumber to the generic Channel abstraction ────────────
ALTER TABLE "whatsapp_numbers" ADD COLUMN "channel_id" TEXT;
ALTER TABLE "whatsapp_numbers" ADD COLUMN "last_error" TEXT;
ALTER TABLE "whatsapp_numbers" ADD COLUMN "last_error_at" TIMESTAMP(3);

-- ─── Schema: per-message and per-campaign channel attribution ─────────────────
ALTER TABLE "messages" ADD COLUMN "whatsapp_number_id" TEXT;
ALTER TABLE "campaigns" ADD COLUMN "whatsapp_number_id" TEXT;

-- ─── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX "conversations_tenant_id_contact_id_whatsapp_number_id_idx"
  ON "conversations"("tenant_id", "contact_id", "whatsapp_number_id");
CREATE INDEX "messages_whatsapp_number_id_idx" ON "messages"("whatsapp_number_id");

-- ─── Foreign keys ───────────────────────────────────────────────────────────
ALTER TABLE "messages" ADD CONSTRAINT "messages_whatsapp_number_id_fkey"
  FOREIGN KEY ("whatsapp_number_id") REFERENCES "whatsapp_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_whatsapp_number_id_fkey"
  FOREIGN KEY ("whatsapp_number_id") REFERENCES "whatsapp_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Backfill 1: create a WhatsAppNumber row for any tenant that has WhatsApp
-- credentials on the Tenant row directly but no corresponding WhatsAppNumber row.
-- This can happen for tenants who only ever went through the legacy
-- TenantService.update quick-save path, which (unlike ChannelsService/
-- WhatsAppNumbersService) never wrote a WhatsAppNumber row. Without this, the
-- new number-aware webhook routing and outbound-send logic would have nothing
-- to resolve for these tenants.
INSERT INTO "whatsapp_numbers" ("id", "tenant_id", "label", "phone_number_id", "waba_id", "access_token", "is_default", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), t."id", 'Default', t."phone_number_id", t."waba_id", t."access_token", true, true, now(), now()
FROM "tenants" t
WHERE t."phone_number_id" IS NOT NULL
  AND t."waba_id" IS NOT NULL
  AND t."access_token" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "whatsapp_numbers" wn
    WHERE wn."tenant_id" = t."id" AND wn."phone_number_id" = t."phone_number_id"
  );

-- ─── Backfill 2: link every WhatsAppNumber to a Channel row, reusing an
-- existing unlinked WHATSAPP-type Channel for the same tenant where one
-- exists (the common case -- ChannelsService/TenantService already create one
-- today), creating a new Channel row otherwise. Runs as a loop rather than a
-- single set-based statement because WhatsAppNumber.channel_id is unique
-- (one Channel per number) and Channel has a [tenant_id, type, name] unique
-- constraint that a naive bulk insert could collide against; a small,
-- deterministic loop is far easier to reason about correctly than a
-- window-function query here, and this runs once against what is, in
-- production today, a small number of tenants/numbers.
DO $$
DECLARE
  num RECORD;
  existing_channel_id TEXT;
  new_channel_id TEXT;
  candidate_name TEXT;
  suffix INT;
BEGIN
  FOR num IN
    SELECT "id", "tenant_id", "label" FROM "whatsapp_numbers"
    WHERE "channel_id" IS NULL
    ORDER BY "is_default" DESC, "created_at" ASC
  LOOP
    -- Try to claim an existing WHATSAPP channel for this tenant that no other
    -- WhatsAppNumber has claimed yet.
    SELECT c."id" INTO existing_channel_id
    FROM "channels" c
    WHERE c."tenant_id" = num."tenant_id"
      AND c."type" = 'WHATSAPP'
      AND NOT EXISTS (SELECT 1 FROM "whatsapp_numbers" wn2 WHERE wn2."channel_id" = c."id")
    ORDER BY c."created_at" ASC
    LIMIT 1;

    IF existing_channel_id IS NOT NULL THEN
      UPDATE "whatsapp_numbers" SET "channel_id" = existing_channel_id WHERE "id" = num."id";
    ELSE
      -- No unclaimed WHATSAPP channel for this tenant -- create one, avoiding
      -- a name collision against [tenant_id, type, name] by appending a
      -- numeric suffix if needed.
      candidate_name := num."label";
      suffix := 1;
      WHILE EXISTS (SELECT 1 FROM "channels" WHERE "tenant_id" = num."tenant_id" AND "type" = 'WHATSAPP' AND "name" = candidate_name) LOOP
        suffix := suffix + 1;
        candidate_name := num."label" || ' ' || suffix;
      END LOOP;

      new_channel_id := gen_random_uuid();
      INSERT INTO "channels" ("id", "tenant_id", "type", "name", "is_active", "credentials", "metadata", "created_at", "updated_at")
      VALUES (new_channel_id, num."tenant_id", 'WHATSAPP', candidate_name, true, '{}', '{}', now(), now());

      UPDATE "whatsapp_numbers" SET "channel_id" = new_channel_id WHERE "id" = num."id";
    END IF;
  END LOOP;
END $$;

-- ─── Add the unique constraint on whatsapp_numbers.channel_id now that every
-- row has a distinct, non-null value from the backfill above (new rows going
-- forward are still allowed to be NULL -- Postgres unique indexes permit
-- multiple NULLs).
CREATE UNIQUE INDEX "whatsapp_numbers_channel_id_key" ON "whatsapp_numbers"("channel_id");
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Backfill 3: set Conversation.whatsapp_number_id's mirrored value onto
-- every existing Message row for that conversation, so per-message channel
-- attribution (new in this migration) has correct historical data instead of
-- starting out entirely NULL for every message sent before today.
UPDATE "messages" m
SET "whatsapp_number_id" = c."whatsapp_number_id"
FROM "conversations" c
WHERE m."conversation_id" = c."id"
  AND c."whatsapp_number_id" IS NOT NULL
  AND m."whatsapp_number_id" IS NULL;
