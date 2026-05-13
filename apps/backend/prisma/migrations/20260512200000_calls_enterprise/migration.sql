-- AlterTable: add enterprise fields to call_logs
ALTER TABLE "call_logs" ADD COLUMN "is_archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "call_logs" ADD COLUMN "end_reason" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "recording_url" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "call_link_token" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "call_link_expires_at" TIMESTAMP(3);
ALTER TABLE "call_logs" ADD COLUMN "answered_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "call_logs_call_link_token_key" ON "call_logs"("call_link_token");
CREATE INDEX "call_logs_tenant_id_is_archived_idx" ON "call_logs"("tenant_id", "is_archived");
