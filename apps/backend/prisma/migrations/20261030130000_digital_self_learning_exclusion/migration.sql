-- Digital Self: conversation-level learning exclusion, per-event features so evidence can be removed exactly, and the link from a style
-- correction to the one Digital Self it applies to. Additive; the new conversations columns are constant-default/nullable (no table rewrite).
-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "digital_self_learning_excluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digital_self_learning_excluded_at" TIMESTAMP(3),
ADD COLUMN     "digital_self_learning_excluded_by_id" TEXT;

-- AlterTable
ALTER TABLE "ai_training_examples" ADD COLUMN     "digital_self_id" TEXT;

-- AlterTable
ALTER TABLE "digital_self_learning_events" ADD COLUMN     "conversation_id" TEXT,
ADD COLUMN     "features" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'REPLY',
ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "digital_self_learning_events_tenant_id_conversation_id_idx" ON "digital_self_learning_events"("tenant_id", "conversation_id");

