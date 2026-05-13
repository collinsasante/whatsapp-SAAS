ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "onboarding_step"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "industry"             TEXT,
  ADD COLUMN IF NOT EXISTS "team_size"            TEXT,
  ADD COLUMN IF NOT EXISTS "country"              TEXT,
  ADD COLUMN IF NOT EXISTS "logo_url"             TEXT,
  ADD COLUMN IF NOT EXISTS "business_category"    TEXT,
  ADD COLUMN IF NOT EXISTS "business_description" TEXT,
  ADD COLUMN IF NOT EXISTS "business_address"     TEXT,
  ADD COLUMN IF NOT EXISTS "business_website"     TEXT;
