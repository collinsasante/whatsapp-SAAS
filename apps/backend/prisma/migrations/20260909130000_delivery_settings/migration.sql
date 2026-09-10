ALTER TABLE "tenant_settings" ADD COLUMN "delivery_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "delivery_info" TEXT;
