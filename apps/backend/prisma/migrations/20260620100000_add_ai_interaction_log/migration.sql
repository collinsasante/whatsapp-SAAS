-- Add aiMode and aiPilotGroup to tenant_settings
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "ai_mode" TEXT NOT NULL DEFAULT 'SUGGESTION';
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "ai_pilot_group" BOOLEAN NOT NULL DEFAULT false;

-- Create ai_interaction_logs table
CREATE TABLE IF NOT EXISTS "ai_interaction_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "customer_message" TEXT NOT NULL,
    "ai_response" TEXT NOT NULL,
    "final_sent_message" TEXT,
    "edited_by_agent" BOOLEAN NOT NULL DEFAULT false,
    "agent_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "confidence_score" DOUBLE PRECISION,
    "response_time_ms" INTEGER,
    "feedback_rating" INTEGER,
    "feedback_label" TEXT,
    "feedback_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interaction_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "ai_interaction_logs_tenant_id_idx" ON "ai_interaction_logs"("tenant_id");
CREATE INDEX IF NOT EXISTS "ai_interaction_logs_conversation_id_idx" ON "ai_interaction_logs"("conversation_id");
CREATE INDEX IF NOT EXISTS "ai_interaction_logs_tenant_id_created_at_idx" ON "ai_interaction_logs"("tenant_id", "created_at");

-- Foreign key
ALTER TABLE "ai_interaction_logs" ADD CONSTRAINT "ai_interaction_logs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
