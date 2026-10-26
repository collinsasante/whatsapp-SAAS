-- The reply deadline for customer requests was a hard-coded 15 minutes. Make it a per-workspace setting.
-- Additive and backwards compatible: existing rows get 15 (today's behaviour), NULL means "no deadline",
-- and code that does not know the column keeps working.
ALTER TABLE "tenant_settings" ADD COLUMN "reply_deadline_minutes" INTEGER DEFAULT 15;
