-- AI Digital Self: additive only (one enum, two tables, one nullable column). Nothing is dropped or rewritten.
-- CreateEnum
CREATE TYPE "DigitalSelfStatus" AS ENUM ('INITIALIZING', 'LEARNING', 'READY', 'NEEDS_MORE_EXAMPLES', 'PAUSED');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "digital_self_id" TEXT;

-- CreateTable
CREATE TABLE "digital_selves" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "DigitalSelfStatus" NOT NULL DEFAULT 'INITIALIZING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "learning_paused" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "profile_version" INTEGER NOT NULL DEFAULT 1,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "last_learned_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_selves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_self_learning_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "digital_self_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_self_learning_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "digital_selves_user_id_key" ON "digital_selves"("user_id");

-- CreateIndex
CREATE INDEX "digital_selves_tenant_id_status_idx" ON "digital_selves"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "digital_self_learning_events_message_id_key" ON "digital_self_learning_events"("message_id");

-- CreateIndex
CREATE INDEX "digital_self_learning_events_tenant_id_digital_self_id_idx" ON "digital_self_learning_events"("tenant_id", "digital_self_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_digital_self_id_idx" ON "conversations"("tenant_id", "digital_self_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_digital_self_id_fkey" FOREIGN KEY ("digital_self_id") REFERENCES "digital_selves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_selves" ADD CONSTRAINT "digital_selves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_selves" ADD CONSTRAINT "digital_selves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_self_learning_events" ADD CONSTRAINT "digital_self_learning_events_digital_self_id_fkey" FOREIGN KEY ("digital_self_id") REFERENCES "digital_selves"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every existing human agent gets a neutral, empty Digital Self. The synthetic Verz AI user (is_ai_agent) and view-only users are not agents.
-- Idempotent: user_id is unique, so a re-run inserts nothing.
INSERT INTO "digital_selves" ("id", "tenant_id", "user_id", "updated_at")
SELECT gen_random_uuid()::text, u."tenant_id", u."id", CURRENT_TIMESTAMP
FROM "users" u
WHERE u."is_ai_agent" = false
  AND u."role" IN ('ADMIN', 'AGENT')
ON CONFLICT ("user_id") DO NOTHING;
