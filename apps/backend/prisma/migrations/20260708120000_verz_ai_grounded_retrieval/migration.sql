-- Verz AI: grounded retrieval + verification + escalation telemetry.
--
-- No pgvector extension is installed on any environment's Postgres image
-- (postgres:16-alpine). Embeddings are stored as plain double precision[]
-- and scored via cosine similarity in application code
-- (EmbeddingRetrievalService) -- fine at current scale. Upgrade path:
-- switch the image to pgvector/pgvector:pg16, change `embedding` to a
-- native `vector(N)` column, and use the `<=>` operator.

CREATE TABLE IF NOT EXISTS "knowledge_base_chunks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
    "embedding_model" TEXT NOT NULL DEFAULT 'local-hash-v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_base_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "knowledge_base_chunks_tenant_id_idx" ON "knowledge_base_chunks"("tenant_id");
CREATE INDEX IF NOT EXISTS "knowledge_base_chunks_article_id_idx" ON "knowledge_base_chunks"("article_id");

ALTER TABLE "knowledge_base_chunks"
    ADD CONSTRAINT "knowledge_base_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "knowledge_base_chunks_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "knowledge_base_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Generated tsvector column for the lexical half of hybrid retrieval. Managed
-- entirely outside Prisma's schema (queried via $queryRaw in
-- EmbeddingRetrievalService) since Prisma has no first-class generated-column
-- support for tsvector.
ALTER TABLE "knowledge_base_chunks" ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED;
CREATE INDEX IF NOT EXISTS "knowledge_base_chunks_content_tsv_idx" ON "knowledge_base_chunks" USING GIN ("content_tsv");

-- Knowledge-gap clustering (Phase 4.2)
CREATE TABLE IF NOT EXISTS "ai_knowledge_gaps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cluster_key" TEXT NOT NULL,
    "example_questions" TEXT[] NOT NULL DEFAULT '{}',
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "draft_article_id" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_knowledge_gaps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_knowledge_gaps_tenant_id_cluster_key_key" ON "ai_knowledge_gaps"("tenant_id", "cluster_key");
CREATE INDEX IF NOT EXISTS "ai_knowledge_gaps_tenant_id_status_idx" ON "ai_knowledge_gaps"("tenant_id", "status");
ALTER TABLE "ai_knowledge_gaps"
    ADD CONSTRAINT "ai_knowledge_gaps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grounding + verification telemetry on ai_interaction_logs (Phase 2/3)
ALTER TABLE "ai_interaction_logs"
    ADD COLUMN IF NOT EXISTS "sources" TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "action" TEXT,
    ADD COLUMN IF NOT EXISTS "verification_passed" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "verification_fail_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "unverified_detail" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "escalation_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "edit_distance_ratio" DOUBLE PRECISION;

-- Per-tenant confidence gate + escalation config (Phase 3) -- default ON for new tenants.
ALTER TABLE "tenant_settings"
    ADD COLUMN IF NOT EXISTS "ai_confidence_threshold" INTEGER NOT NULL DEFAULT 75,
    ADD COLUMN IF NOT EXISTS "ai_holding_message" TEXT,
    ADD COLUMN IF NOT EXISTS "ai_verification_enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "ai_debounce_enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "ai_max_consecutive_replies" INTEGER NOT NULL DEFAULT 5;
