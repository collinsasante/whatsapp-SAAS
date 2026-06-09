ALTER TABLE "tenant_settings"
  ADD COLUMN "airtable_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "airtable_api_key" TEXT,
  ADD COLUMN "airtable_base_id" TEXT,
  ADD COLUMN "airtable_table_name" TEXT;
