-- AI Learning Phase 1: per-workspace controls and the platform-funded learning cost ledger. Additive only: two new tables and one enum;
-- nothing existing is altered. Learning stays OFF for every workspace until an admin opts in (learning_enabled defaults to false).

-- CreateEnum
CREATE TYPE "AiLearningUsageState" AS ENUM ('RESERVED', 'COMPLETED', 'FAILED', 'EXPIRED', 'FENCED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ai_learning_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "learning_enabled" BOOLEAN NOT NULL DEFAULT false,
    "learning_paused" BOOLEAN NOT NULL DEFAULT false,
    "approved_guidance_enabled" BOOLEAN NOT NULL DEFAULT true,
    "monthly_budget_micros" BIGINT,
    "enabled_at" TIMESTAMP(3),
    "enabled_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_learning_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_learning_usage" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ai_execution_id" TEXT NOT NULL,
    "run_no" INTEGER NOT NULL,
    "state" "AiLearningUsageState" NOT NULL,
    "reserved_micros" BIGINT NOT NULL,
    "actual_micros" BIGINT,
    "estimated_input_tokens" INTEGER NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "price_table_version" TEXT NOT NULL,
    "skip_reason" TEXT,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_learning_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_learning_settings_tenant_id_key" ON "ai_learning_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_learning_usage_tenant_id_created_at_idx" ON "ai_learning_usage"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_learning_usage_state_lease_expires_at_idx" ON "ai_learning_usage"("state", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_learning_usage_ai_execution_id_run_no_key" ON "ai_learning_usage"("ai_execution_id", "run_no");

-- At most ONE live reservation per execution. A takeover must first move the old RESERVED row to EXPIRED, so two runs can never both
-- hold a reservation for the same execution, whatever order their statements interleave in. Partial, so it is raw SQL (Prisma cannot
-- express it).
CREATE UNIQUE INDEX "ai_learning_usage_one_reserved_per_execution" ON "ai_learning_usage"("ai_execution_id") WHERE "state" = 'RESERVED';

-- Money is stored in micro-USD and must never be negative.
ALTER TABLE "ai_learning_usage" ADD CONSTRAINT "ai_learning_usage_amounts_nonnegative"
    CHECK ("reserved_micros" >= 0 AND ("actual_micros" IS NULL OR "actual_micros" >= 0) AND "run_no" >= 1);

-- AddForeignKey
ALTER TABLE "ai_learning_settings" ADD CONSTRAINT "ai_learning_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_learning_usage" ADD CONSTRAINT "ai_learning_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
