-- Add AI credits wallet to tenants
ALTER TABLE "tenants" ADD COLUMN "ai_credits" INTEGER NOT NULL DEFAULT 0;

-- Add AI trial tracking to tenant_settings
ALTER TABLE "tenant_settings" ADD COLUMN "ai_trial_started_at" TIMESTAMP(3);
ALTER TABLE "tenant_settings" ADD COLUMN "ai_trial_approved_at" TIMESTAMP(3);

-- Create credit_purchases table
CREATE TABLE "credit_purchases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "pack_slug" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paystack_ref" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_purchases_paystack_ref_key" ON "credit_purchases"("paystack_ref");
CREATE INDEX "credit_purchases_tenant_id_idx" ON "credit_purchases"("tenant_id");

ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
