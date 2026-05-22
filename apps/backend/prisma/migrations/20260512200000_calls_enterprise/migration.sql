-- AlterTable: add enterprise fields to call_logs (all IF NOT EXISTS — safe to re-run)
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "end_reason" TEXT;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "recording_url" TEXT;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "call_link_token" TEXT;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "call_link_expires_at" TIMESTAMP(3);
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "answered_at" TIMESTAMP(3);

-- CreateIndex (skip if already exists)
CREATE UNIQUE INDEX IF NOT EXISTS "call_logs_call_link_token_key" ON "call_logs"("call_link_token");
CREATE INDEX IF NOT EXISTS "call_logs_tenant_id_is_archived_idx" ON "call_logs"("tenant_id", "is_archived");
