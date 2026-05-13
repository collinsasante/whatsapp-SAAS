-- AlterTable: make contact_id optional on call_logs
ALTER TABLE "call_logs" ALTER COLUMN "contact_id" DROP NOT NULL;

-- AlterTable: add phone column to call_logs
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- AlterEnum: add TRANSFERRED to CallStatus
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'TRANSFERRED';

-- CreateIndex: status index on call_logs
CREATE INDEX IF NOT EXISTS "call_logs_tenant_id_status_idx" ON "call_logs"("tenant_id", "status");

-- CreateTable: call_notes
CREATE TABLE IF NOT EXISTS "call_notes" (
    "id" TEXT NOT NULL,
    "call_log_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "call_notes_call_log_id_idx" ON "call_notes"("call_log_id");

-- AddForeignKey
ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_call_log_id_fkey"
    FOREIGN KEY ("call_log_id") REFERENCES "call_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
