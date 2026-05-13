-- Extend tenant_settings with manage fields
ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "welcome_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "welcome_message" TEXT,
  ADD COLUMN IF NOT EXISTS "off_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "off_hours_message" TEXT,
  ADD COLUMN IF NOT EXISTS "off_hours_schedule" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "opt_out_keywords" TEXT[] DEFAULT ARRAY['STOP', 'UNSUBSCRIBE']::TEXT[],
  ADD COLUMN IF NOT EXISTS "opt_in_keywords" TEXT[] DEFAULT ARRAY['START', 'SUBSCRIBE']::TEXT[],
  ADD COLUMN IF NOT EXISTS "opt_out_reply" TEXT,
  ADD COLUMN IF NOT EXISTS "opt_in_reply" TEXT,
  ADD COLUMN IF NOT EXISTS "widget_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "widget_config" JSONB NOT NULL DEFAULT '{}';

-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('TEXT', 'NUMBER', 'DROPDOWN', 'DATE', 'BOOLEAN');

-- CreateTable: tags
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0d9488',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable: contact_attributes
CREATE TABLE "contact_attributes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AttributeType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: webhooks
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "tags_tenant_id_name_key" ON "tags"("tenant_id", "name");
CREATE INDEX "tags_tenant_id_idx" ON "tags"("tenant_id");

CREATE UNIQUE INDEX "contact_attributes_tenant_id_key_key" ON "contact_attributes"("tenant_id", "key");
CREATE INDEX "contact_attributes_tenant_id_idx" ON "contact_attributes"("tenant_id");

CREATE INDEX "webhooks_tenant_id_idx" ON "webhooks"("tenant_id");

-- Foreign keys
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_attributes" ADD CONSTRAINT "contact_attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
