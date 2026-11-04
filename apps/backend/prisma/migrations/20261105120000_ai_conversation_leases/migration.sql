-- Additive: cross-replica lease for per-conversation AI turns. No existing table or column is changed.
CREATE TABLE IF NOT EXISTS "ai_conversation_leases" (
    "conversation_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_conversation_leases_pkey" PRIMARY KEY ("conversation_id")
);
CREATE INDEX IF NOT EXISTS "ai_conversation_leases_expires_at_idx" ON "ai_conversation_leases"("expires_at");
