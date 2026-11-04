DROP TABLE IF EXISTS "ai_cap_alerts";
ALTER TABLE "tenant_settings" DROP CONSTRAINT IF EXISTS "tenant_settings_ai_cap_warn_percent_range";
ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "ai_cap_warn_percent";
