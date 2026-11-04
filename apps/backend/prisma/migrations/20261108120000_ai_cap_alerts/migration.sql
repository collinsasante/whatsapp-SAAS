-- Additive: a nullable column on tenant_settings (metadata-only, no rewrite) and a new table. Nothing existing is altered.
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "ai_cap_warn_percent" INTEGER;
DO $$ BEGIN
  ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_ai_cap_warn_percent_range" CHECK ("ai_cap_warn_percent" IS NULL OR ("ai_cap_warn_percent" >= 1 AND "ai_cap_warn_percent" <= 99));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ai_cap_alerts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "day_key" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "cap" INTEGER NOT NULL,
  "spent" INTEGER NOT NULL,
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_cap_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_cap_alerts_tenant_id_day_key_level_key" ON "ai_cap_alerts"("tenant_id", "day_key", "level");
CREATE INDEX IF NOT EXISTS "ai_cap_alerts_created_at_idx" ON "ai_cap_alerts"("created_at");
DO $$ BEGIN
  ALTER TABLE "ai_cap_alerts" ADD CONSTRAINT "ai_cap_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
