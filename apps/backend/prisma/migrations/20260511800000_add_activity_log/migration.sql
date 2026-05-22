-- CreateEnum: ActivityAction (base values — extended by later migrations)
DO $$ BEGIN
  CREATE TYPE "ActivityAction" AS ENUM (
    'CONVERSATION_CREATED',
    'CONVERSATION_ASSIGNED',
    'CONVERSATION_UNASSIGNED',
    'CONVERSATION_RESOLVED',
    'CONVERSATION_REOPENED',
    'MESSAGE_SENT',
    'MESSAGE_EDITED',
    'MESSAGE_DELETED',
    'MESSAGE_STARRED',
    'NOTE_ADDED',
    'NOTE_DELETED',
    'TAG_ADDED',
    'TAG_REMOVED',
    'CONTACT_UPDATED',
    'CONTACT_BLOCKED',
    'AUTOMATION_TRIGGERED',
    'CAMPAIGN_LAUNCHED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: activity_logs
CREATE TABLE IF NOT EXISTS "activity_logs" (
    "id"              TEXT NOT NULL,
    "tenant_id"       TEXT NOT NULL,
    "conversation_id" TEXT,
    "contact_id"      TEXT,
    "user_id"         TEXT,
    "action"          "ActivityAction" NOT NULL,
    "metadata"        JSONB NOT NULL DEFAULT '{}',
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "activity_logs_tenant_id_created_at_idx" ON "activity_logs"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "activity_logs_conversation_id_idx" ON "activity_logs"("conversation_id");

-- FKs
DO $$ BEGIN
  ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
