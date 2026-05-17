-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('STRIPE', 'PAYSTACK', 'FLUTTERWAVE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateTable
CREATE TABLE "billing_plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthly_price" DOUBLE PRECISION NOT NULL,
    "yearly_price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "lim_max_agents" INTEGER NOT NULL DEFAULT 1,
    "lim_max_channels" INTEGER NOT NULL DEFAULT 1,
    "lim_max_contacts" INTEGER NOT NULL DEFAULT 500,
    "lim_max_templates" INTEGER NOT NULL DEFAULT 5,
    "lim_messages_per_month" INTEGER NOT NULL DEFAULT 1000,
    "lim_max_campaigns" INTEGER NOT NULL DEFAULT 0,
    "lim_ai_credits_per_month" INTEGER NOT NULL DEFAULT 0,
    "lim_storage_gb" INTEGER NOT NULL DEFAULT 1,
    "features" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMP(3),
    "stripe_subscription_id" TEXT,
    "paystack_subscription_code" TEXT,
    "flutterwave_subscription_id" TEXT,
    "gateway_customer_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billing_period_start" TIMESTAMP(3) NOT NULL,
    "billing_period_end" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "billing_email" TEXT,
    "billing_name" TEXT,
    "gateway" "PaymentGateway",
    "gateway_invoice_id" TEXT,
    "gateway_payment_url" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "gateway" "PaymentGateway" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "gateway_payment_id" TEXT,
    "gateway_reference" TEXT,
    "gateway_webhook_data" JSONB,
    "verified_at" TIMESTAMP(3),
    "fail_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_usage" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "messages_sent" INTEGER NOT NULL DEFAULT 0,
    "messages_received" INTEGER NOT NULL DEFAULT 0,
    "conversations_opened" INTEGER NOT NULL DEFAULT 0,
    "campaigns_sent" INTEGER NOT NULL DEFAULT 0,
    "ai_credits_used" INTEGER NOT NULL DEFAULT 0,
    "active_agents" INTEGER NOT NULL DEFAULT 0,
    "active_channels" INTEGER NOT NULL DEFAULT 0,
    "storage_used_mb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "gateway" "PaymentGateway",
    "gateway_event_id" TEXT,
    "data" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" TEXT NOT NULL,
    "discount_value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "applicable_plans" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_usages" (
    "id" TEXT NOT NULL,
    "promo_code_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "discount_applied" DOUBLE PRECISION NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_slug_key" ON "billing_plans"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_paystack_subscription_code_key" ON "subscriptions"("paystack_subscription_code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_flutterwave_subscription_id_key" ON "subscriptions"("flutterwave_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_current_period_end_idx" ON "subscriptions"("current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_created_at_idx" ON "invoices"("created_at");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_payment_id_key" ON "payments"("gateway_payment_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_idx" ON "payments"("tenant_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_gateway_idx" ON "payments"("gateway");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_usage_tenant_id_period_start_key" ON "workspace_usage"("tenant_id", "period_start");

-- CreateIndex
CREATE INDEX "workspace_usage_tenant_id_idx" ON "workspace_usage"("tenant_id");

-- CreateIndex
CREATE INDEX "billing_events_tenant_id_idx" ON "billing_events"("tenant_id");

-- CreateIndex
CREATE INDEX "billing_events_event_idx" ON "billing_events"("event");

-- CreateIndex
CREATE INDEX "billing_events_processed_idx" ON "billing_events"("processed");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_usages_promo_code_id_tenant_id_key" ON "promo_code_usages"("promo_code_id", "tenant_id");

-- CreateIndex
CREATE INDEX "promo_code_usages_tenant_id_idx" ON "promo_code_usages"("tenant_id");

-- Seed default plans
INSERT INTO "billing_plans" ("id", "slug", "name", "description", "monthly_price", "yearly_price", "trial_days", "lim_max_agents", "lim_max_channels", "lim_max_contacts", "lim_max_templates", "lim_messages_per_month", "lim_max_campaigns", "lim_ai_credits_per_month", "lim_storage_gb", "features", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'free',       'Free',       'Perfect for getting started',          0,    0,    0, 1,  1,  500,   5,   1000, 0,  0,  1,  '["1 WhatsApp Channel","500 Contacts","1,000 Messages/mo","1 Agent","5 Templates"]', 0, NOW()),
  (gen_random_uuid(), 'starter',    'Starter',    'For small teams and growing businesses', 29,  290,  14, 3,  2,  5000,  20,  5000, 2,  100, 5,  '["2 WhatsApp Channels","5,000 Contacts","5,000 Messages/mo","3 Agents","20 Templates","CSV Import","Campaigns","14-day Trial"]', 1, NOW()),
  (gen_random_uuid(), 'growth',     'Growth',     'Scale your customer communications',   79,  790,  14, 10, 5, 50000, -1, 25000, 10, 500, 20, '["5 Channels","50,000 Contacts","25,000 Messages/mo","10 Agents","Unlimited Templates","Campaigns","Automation","AI Credits","14-day Trial"]', 2, NOW()),
  (gen_random_uuid(), 'enterprise', 'Enterprise', 'For large organizations',              -1,  -1,   0,  -1, -1, -1,    -1, -1,    -1, -1,  -1, '["Unlimited Channels","Unlimited Contacts","Unlimited Messages","Unlimited Agents","Priority Support","Custom Integrations","Dedicated Manager","SLA"]', 3, NOW());

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_usage" ADD CONSTRAINT "workspace_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_usages" ADD CONSTRAINT "promo_code_usages_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
