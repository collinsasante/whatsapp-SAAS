-- AlterTable: add source tracking fields to conversations
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "contact_source" TEXT NOT NULL DEFAULT 'organic',
  ADD COLUMN IF NOT EXISTS "ad_source_id"   TEXT,
  ADD COLUMN IF NOT EXISTS "ad_headline"    TEXT;
