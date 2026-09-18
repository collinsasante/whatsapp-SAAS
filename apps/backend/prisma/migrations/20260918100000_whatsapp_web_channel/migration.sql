-- Unofficial WhatsApp Web / linked-device channel work: a new ChannelType
-- value and a dedicated WhatsAppWebSession table, mirroring the
-- FacebookPageConnection/WhatsAppNumber pattern (one typed table per
-- concrete connected account, 1:1 with a generic Channel row). Purely
-- additive: no columns dropped, no data destroyed, no existing constraint
-- tightened. Deliberately a SEPARATE model from WhatsAppNumber (the
-- official Cloud API model) -- different lifecycle (a live socket
-- connection + session auth state vs. a static API token), and the two
-- must never be conflated.

-- ─── ChannelType: new value for the unofficial WhatsApp Web connection ─────
ALTER TYPE "ChannelType" ADD VALUE 'WHATSAPP_WEB';

-- ─── New table: WhatsAppWebSession ──────────────────────────────────────────
CREATE TABLE "whatsapp_web_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "phone_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QR_PENDING',
    "encrypted_auth_state" TEXT,
    "connected_by_user_id" TEXT,
    "last_connected_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_web_sessions_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "whatsapp_web_sessions_channel_id_key" ON "whatsapp_web_sessions"("channel_id");
CREATE INDEX "whatsapp_web_sessions_tenant_id_idx" ON "whatsapp_web_sessions"("tenant_id");
CREATE INDEX "whatsapp_web_sessions_status_idx" ON "whatsapp_web_sessions"("status");

-- ─── Foreign keys ────────────────────────────────────────────────────────
ALTER TABLE "whatsapp_web_sessions" ADD CONSTRAINT "whatsapp_web_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_web_sessions" ADD CONSTRAINT "whatsapp_web_sessions_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
