ALTER TABLE "knowledge_base_articles" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "knowledge_base_articles" ADD COLUMN "source_ref" TEXT;
