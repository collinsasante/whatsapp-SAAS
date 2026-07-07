-- Remove MoMo/Flutterwave, Stripe + Paystack are now the only supported payment gateways.
-- This project is pre-production for billing (no live subscriptions), so legacy gateway
-- values on existing rows are simply remapped rather than migrated.

-- Remap any legacy MOMO/FLUTTERWAVE gateway values before shrinking the enum
UPDATE "payments" SET "gateway" = 'PAYSTACK' WHERE "gateway"::text IN ('MOMO', 'FLUTTERWAVE');
UPDATE "invoices" SET "gateway" = NULL WHERE "gateway"::text IN ('MOMO', 'FLUTTERWAVE');
UPDATE "billing_events" SET "gateway" = NULL WHERE "gateway"::text IN ('MOMO', 'FLUTTERWAVE');

-- Shrink PaymentGateway enum to STRIPE, PAYSTACK only
CREATE TYPE "PaymentGateway_new" AS ENUM ('STRIPE', 'PAYSTACK');
ALTER TABLE "payments" ALTER COLUMN "gateway" TYPE "PaymentGateway_new" USING ("gateway"::text::"PaymentGateway_new");
ALTER TABLE "invoices" ALTER COLUMN "gateway" TYPE "PaymentGateway_new" USING ("gateway"::text::"PaymentGateway_new");
ALTER TABLE "billing_events" ALTER COLUMN "gateway" TYPE "PaymentGateway_new" USING ("gateway"::text::"PaymentGateway_new");
DROP TYPE "PaymentGateway";
ALTER TYPE "PaymentGateway_new" RENAME TO "PaymentGateway";

-- Drop Flutterwave-specific subscription column
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "flutterwave_subscription_id";

-- Tag credit purchases with which gateway was used
ALTER TABLE "credit_purchases" ADD COLUMN IF NOT EXISTS "gateway" "PaymentGateway";

-- Plan pricing/identifiers needed to provision real Stripe Prices and Paystack Plans
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "ghs_monthly_price" DOUBLE PRECISION;
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "ghs_yearly_price" DOUBLE PRECISION;
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "stripe_price_id_monthly" TEXT;
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "stripe_price_id_yearly" TEXT;
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "paystack_plan_code_monthly" TEXT;
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "paystack_plan_code_yearly" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "billing_plans_stripe_price_id_monthly_key" ON "billing_plans"("stripe_price_id_monthly");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plans_stripe_price_id_yearly_key" ON "billing_plans"("stripe_price_id_yearly");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plans_paystack_plan_code_monthly_key" ON "billing_plans"("paystack_plan_code_monthly");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plans_paystack_plan_code_yearly_key" ON "billing_plans"("paystack_plan_code_yearly");
