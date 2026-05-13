-- AddValue
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'REQUESTED';
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'INTERVENED';

-- AlterTable: Add new columns to conversations
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "resolved_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reopened_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "requested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "intervened_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reopened_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sla_deadline" TIMESTAMP(3);

-- AddForeignKey for resolved_by_id
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: ConversationEventType
DO $$ BEGIN
  CREATE TYPE "ConversationEventType" AS ENUM (
    'OPENED', 'REQUESTED', 'INTERVENED', 'RESOLVED', 'REOPENED',
    'ASSIGNED', 'UNASSIGNED', 'TRANSFERRED', 'NOTE_ADDED',
    'TAG_ADDED', 'TAG_REMOVED', 'BOT_PAUSED', 'BOT_RESUMED', 'SLA_BREACHED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: conversation_events
CREATE TABLE IF NOT EXISTS "conversation_events" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "type" "ConversationEventType" NOT NULL,
  "actor_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKeys for conversation_events
DO $$ BEGIN
  ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndexes for conversation_events
CREATE INDEX IF NOT EXISTS "conversation_events_conversation_id_idx" ON "conversation_events"("conversation_id");
CREATE INDEX IF NOT EXISTS "conversation_events_tenant_id_idx" ON "conversation_events"("tenant_id");

-- CreateIndex for conversations sla_deadline
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_sla_deadline_idx" ON "conversations"("tenant_id", "sla_deadline");

-- AddValue to ActivityAction enum
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CONVERSATION_REQUESTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CONVERSATION_INTERVENED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CONVERSATION_TRANSFERRED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CONVERSATION_ARCHIVED';

-- AddValue to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONVERSATION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONVERSATION_INTERVENED';
