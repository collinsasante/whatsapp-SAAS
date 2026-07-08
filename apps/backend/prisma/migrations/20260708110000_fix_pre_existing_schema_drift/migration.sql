-- Fixes pre-existing drift between schema.prisma and the tracked migration
-- history, found while diagnosing 500s on GET /conversations and GET
-- /manage/settings on staging ("column ... does not exist"). This drift
-- predates and is unrelated to the Verz AI work -- some of these fields were
-- clearly added via `prisma db push` directly against a database at some
-- point and never captured in a migration file, so `prisma migrate deploy`
-- never applied them anywhere that only ever ran tracked migrations
-- (staging, and -- not yet hit, but equally exposed -- production).
--
-- Additive only, on purpose. `prisma migrate diff` also proposed several
-- DROP COLUMN / DROP CONSTRAINT / DROP INDEX / column-type changes to fully
-- reconcile schema.prisma with the migration history -- those are left out
-- of this emergency fix and need dedicated review with actual data
-- inspection first (e.g. canned_responses.category, conversation_events's
-- metadata->payload rename, feature_flags.rollout_type->rolloutType,
-- platform_settings.updatedBy->updated_by all look like renames where
-- dropping the old column risks real data loss if anything still reads it).
-- This migration ADDS the new-named columns alongside the old ones so the
-- app (which reads the new names per current schema.prisma) works, without
-- deleting anything.

-- New channel type + channels table (backs Conversation.channelId)
DO $$ BEGIN
    CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'FACEBOOK_MESSENGER', 'INSTAGRAM', 'TELEGRAM', 'EMAIL', 'WEB_CHAT', 'TIKTOK', 'TWITTER', 'LINKEDIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'NOTE';

CREATE TABLE IF NOT EXISTS "channels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "channels_tenant_id_idx" ON "channels"("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "channels_tenant_id_type_name_key" ON "channels"("tenant_id", "type", "name");

CREATE TABLE IF NOT EXISTS "message_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "message_reactions_message_id_idx" ON "message_reactions"("message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_id_user_id_emoji_key" ON "message_reactions"("message_id", "user_id", "emoji");

CREATE TABLE IF NOT EXISTS "pinned_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "pinned_by_id" TEXT NOT NULL,
    "pinned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pinned_messages_conversation_id_idx" ON "pinned_messages"("conversation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pinned_messages_conversation_id_message_id_key" ON "pinned_messages"("conversation_id", "message_id");

-- The confirmed cause of the GET /conversations 500
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "channel_id" TEXT;

-- The confirmed cause of the GET /manage/settings 500
ALTER TABLE "tenant_settings"
    ADD COLUMN IF NOT EXISTS "business_address" TEXT,
    ADD COLUMN IF NOT EXISTS "business_description" TEXT,
    ADD COLUMN IF NOT EXISTS "business_website" TEXT;

-- Same class of drift on tables not yet hit, but equally exposed
ALTER TABLE "messages"
    ADD COLUMN IF NOT EXISTS "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "is_starred" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "reply_to_id" TEXT;

ALTER TABLE "conversation_events" ADD COLUMN IF NOT EXISTS "payload" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "feature_flags" ADD COLUMN IF NOT EXISTS "rolloutType" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "updated_by" TEXT;

CREATE INDEX IF NOT EXISTS "conversation_events_tenant_id_created_at_idx" ON "conversation_events"("tenant_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "messages_tenant_id_whatsapp_message_id_key" ON "messages"("tenant_id", "whatsapp_message_id");

-- Foreign keys for the additive columns/tables above (guarded -- safe to
-- re-run if a constraint with this name somehow already exists)
DO $$ BEGIN
    ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_pinned_by_id_fkey" FOREIGN KEY ("pinned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
