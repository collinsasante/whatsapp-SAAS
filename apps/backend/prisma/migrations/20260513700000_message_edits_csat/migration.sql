-- CreateTable: message_edits for edit history
CREATE TABLE "message_edits" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "previous_content" TEXT NOT NULL,
    "edited_by_id" TEXT,
    "edited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_edits_pkey" PRIMARY KEY ("id")
);

-- AddIndex
CREATE INDEX "message_edits_message_id_idx" ON "message_edits"("message_id");
CREATE INDEX "message_edits_tenant_id_idx" ON "message_edits"("tenant_id");

-- AddForeignKey
ALTER TABLE "message_edits" ADD CONSTRAINT "message_edits_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_edits" ADD CONSTRAINT "message_edits_edited_by_id_fkey" FOREIGN KEY ("edited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add CSAT fields to conversations
ALTER TABLE "conversations"
    ADD COLUMN "csat_score" INTEGER,
    ADD COLUMN "csat_comment" TEXT,
    ADD COLUMN "csat_submitted_at" TIMESTAMP(3);
