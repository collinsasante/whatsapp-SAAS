ALTER TABLE "tenant_settings" DROP CONSTRAINT IF EXISTS "tenant_settings_ai_daily_credit_cap_nonnegative";
ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "ai_daily_credit_cap";
