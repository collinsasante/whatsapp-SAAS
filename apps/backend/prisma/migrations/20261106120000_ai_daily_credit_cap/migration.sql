-- Additive and metadata-only: a nullable column without a default does not rewrite tenant_settings.
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "ai_daily_credit_cap" INTEGER;
DO $$ BEGIN
  ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_ai_daily_credit_cap_nonnegative" CHECK ("ai_daily_credit_cap" IS NULL OR "ai_daily_credit_cap" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
