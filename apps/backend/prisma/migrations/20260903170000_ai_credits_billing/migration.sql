-- CreateEnum
CREATE TYPE "AiCreditTransactionType" AS ENUM ('PURCHASE', 'BONUS', 'AI_USAGE', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "ai_credit_transactions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "AiCreditTransactionType" NOT NULL,
    "credits" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "ai_execution_id" TEXT,
    "credit_purchase_id" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_pricing_configs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "input_cost_per_million_usd" DOUBLE PRECISION NOT NULL,
    "output_cost_per_million_usd" DOUBLE PRECISION NOT NULL,
    "credits_per_usd" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_pricing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_packages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "bonus_credits" INTEGER NOT NULL DEFAULT 0,
    "price_ghs" DOUBLE PRECISION,
    "price_usd" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_transactions_ai_execution_id_key" ON "ai_credit_transactions"("ai_execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_transactions_credit_purchase_id_key" ON "ai_credit_transactions"("credit_purchase_id");

-- CreateIndex
CREATE INDEX "ai_credit_transactions_tenant_id_created_at_idx" ON "ai_credit_transactions"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_pricing_configs_provider_model_key_key" ON "ai_pricing_configs"("provider", "model_key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_credit_packages_slug_key" ON "ai_credit_packages"("slug");

-- AddForeignKey
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_credit_purchase_id_fkey" FOREIGN KEY ("credit_purchase_id") REFERENCES "credit_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed data: DeepSeek pricing (matches model-catalog.ts) and the initial credit
-- package tiers (GHS via Paystack, USD via Stripe -- see billing.service.ts).
-- All admin-editable afterwards via /platform-admin/ai/pricing and
-- /platform-admin/ai/credit-packages -- these are just safe starting defaults so
-- charging/purchasing work correctly on day one without a manual DB write first.
INSERT INTO "ai_pricing_configs" ("id", "provider", "model_key", "input_cost_per_million_usd", "output_cost_per_million_usd", "credits_per_usd", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'deepseek', 'deepseek-v4-flash', 0.14, 0.28, 2000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "ai_credit_packages" ("id", "slug", "name", "credits", "bonus_credits", "price_ghs", "price_usd", "is_active", "display_order", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'starter-1000', 'Starter',  1000,  0,   10,  5,  true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'growth-3000',  'Growth',   3000,  0,   25,  12, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'pro-7000',     'Pro',      7000,  0,   50,  25, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'scale-15000',  'Scale',    15000, 0,   100, 55, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Seed the 5% global commerce-fee default (the approved decision: automatic for
-- every commerce-enabled tenant, not per-tenant opt-in). An explicit
-- TenantSettings.takeRatePct still always overrides this when platform-admin sets
-- one. Editable afterwards via PATCH /platform-admin/settings/commerce-fee.
INSERT INTO "platform_settings" ("id", "key", "value", "updated_at")
VALUES (gen_random_uuid()::text, 'default_commerce_fee_pct', '5'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
