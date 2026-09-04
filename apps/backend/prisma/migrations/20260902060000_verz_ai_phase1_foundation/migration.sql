-- Verz-AI Phase 1 foundation: AiAgent, AiPromptTemplate, AiPromptVersion, AiExecution.
-- Isolated from pre-existing schema drift unrelated to this change (this repo has a
-- history of drift between committed migrations and schema.prisma on unrelated tables;
-- only the statements below are new for this migration).

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "agent_user_id" TEXT,
    "system_instructions" TEXT,
    "personality" TEXT,
    "tone" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "model_key" TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
    "max_response_tokens" INTEGER NOT NULL DEFAULT 400,
    "confidence_threshold" INTEGER,
    "allowed_tools" JSONB,
    "knowledge_source_ids" TEXT[],
    "assigned_number_ids" TEXT[],
    "working_hours" JSONB,
    "escalation_rules" JSONB,
    "handoff_settings" JSONB,
    "memory_settings" JSONB,
    "safety_rules" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "change_note" TEXT,
    "created_by_id" TEXT,
    "activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_executions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "conversation_id" TEXT,
    "interaction_log_id" TEXT,
    "prompt_version_id" TEXT,
    "task_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "est_cost_usd" DECIMAL(10,6),
    "confidence" DOUBLE PRECISION,
    "safety_flags" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "stage_timings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_agent_user_id_key" ON "ai_agents"("agent_user_id");

-- CreateIndex
CREATE INDEX "ai_agents_tenant_id_idx" ON "ai_agents"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_tenant_id_name_key" ON "ai_agents"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_key_key" ON "ai_prompt_templates"("key");

-- CreateIndex
CREATE INDEX "ai_prompt_versions_template_id_status_idx" ON "ai_prompt_versions"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_versions_template_id_version_key" ON "ai_prompt_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "ai_executions_tenant_id_created_at_idx" ON "ai_executions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_executions_conversation_id_idx" ON "ai_executions"("conversation_id");

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_agent_user_id_fkey" FOREIGN KEY ("agent_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "ai_prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
