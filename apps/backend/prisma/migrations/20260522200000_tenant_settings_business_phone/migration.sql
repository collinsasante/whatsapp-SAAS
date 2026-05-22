-- Add missing business_phone column to tenant_settings
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "business_phone" TEXT;
