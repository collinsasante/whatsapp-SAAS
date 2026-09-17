-- Facebook Messenger channel work: real indexed Channel.externalId, non-phone
-- Contact identity, a dedicated FacebookPageConnection table, a short-lived
-- OAuthConnectSession table, and generic per-message channel attribution.
-- Purely additive: no columns dropped, no data destroyed, no existing
-- constraint tightened in a way that could reject existing rows (Contact.phone
-- becomes nullable, never the reverse). Safe against a live production
-- database with existing tenants/contacts/channels/messages in any combination.

-- ─── Channel: real, indexed external-account identifier ───────────────────
-- Previously only reachable via a JSON path query into `credentials`.
-- Nullable for channel types with no such concept (WhatsApp, EMAIL,
-- WEB_CHAT) -- Postgres allows multiple NULLs in a unique index.
ALTER TABLE "channels" ADD COLUMN "external_id" TEXT;

-- ─── Contact: non-phone platform identity ──────────────────────────────────
-- phone was NOT NULL; a contact reached via a platform identifier (e.g.
-- Facebook PSID) has no real phone number. Postgres treats every NULL as
-- distinct in a unique index, so this coexists safely with the existing
-- @@unique([tenant_id, phone]) with zero risk to the ~100% phone-only data
-- that exists today.
ALTER TABLE "contacts" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "contacts" ADD COLUMN "external_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN "external_id_type" TEXT;

-- ─── Message: generic per-message channel attribution ──────────────────────
-- Mirrors the already-present Conversation.channel_id. WhatsApp continues to
-- use whatsapp_number_id; this is populated for Messenger (and future
-- non-WhatsApp channels) going forward.
ALTER TABLE "messages" ADD COLUMN "channel_id" TEXT;

-- ─── New table: FacebookPageConnection ──────────────────────────────────────
-- One typed row per connected Facebook Page, 1:1 with a FACEBOOK_MESSENGER
-- Channel row -- mirrors WhatsAppNumber's shape exactly (typed fields,
-- encrypted token, expiry/status tracking) rather than Channel's opaque
-- `credentials` JSON.
CREATE TABLE "facebook_page_connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "page_name" TEXT NOT NULL,
    "page_access_token" TEXT NOT NULL,
    "page_access_token_expires_at" TIMESTAMP(3),
    "subscribed_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "webhook_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "connected_by_user_id" TEXT,
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facebook_page_connections_pkey" PRIMARY KEY ("id")
);

-- ─── New table: OAuthConnectSession ─────────────────────────────────────────
-- Short-lived holding state between "Meta OAuth callback completed" and "user
-- submitted their Page selection" -- see ChannelsService. One-time use,
-- deleted by the selection endpoint once consumed and lazily swept for
-- expiry on the next OAuth-init call (no cron/scheduler exists in this
-- backend to run on a timer).
CREATE TABLE "oauth_connect_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "user_access_token" TEXT NOT NULL,
    "candidate_pages" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_connect_sessions_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "channels_tenant_id_type_external_id_key" ON "channels"("tenant_id", "type", "external_id");
CREATE UNIQUE INDEX "contacts_tenant_id_external_id_type_external_id_key" ON "contacts"("tenant_id", "external_id_type", "external_id");
CREATE INDEX "messages_channel_id_idx" ON "messages"("channel_id");
CREATE UNIQUE INDEX "facebook_page_connections_channel_id_key" ON "facebook_page_connections"("channel_id");
CREATE INDEX "facebook_page_connections_tenant_id_idx" ON "facebook_page_connections"("tenant_id");
CREATE UNIQUE INDEX "facebook_page_connections_tenant_id_page_id_key" ON "facebook_page_connections"("tenant_id", "page_id");
CREATE INDEX "oauth_connect_sessions_tenant_id_idx" ON "oauth_connect_sessions"("tenant_id");
CREATE INDEX "oauth_connect_sessions_expires_at_idx" ON "oauth_connect_sessions"("expires_at");

-- ─── Foreign keys ────────────────────────────────────────────────────────
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "facebook_page_connections" ADD CONSTRAINT "facebook_page_connections_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "facebook_page_connections" ADD CONSTRAINT "facebook_page_connections_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_connect_sessions" ADD CONSTRAINT "oauth_connect_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill: Channel.external_id from the existing credentials.externalId
-- JSON key, for every OAuth-connected channel (Facebook/Instagram/Telegram/
-- TikTok) that has one today. WhatsApp-type channels have no `externalId` key
-- in their credentials JSON and are correctly left NULL here.
UPDATE "channels"
SET "external_id" = "credentials"->>'externalId'
WHERE "credentials"->>'externalId' IS NOT NULL
  AND "external_id" IS NULL;
