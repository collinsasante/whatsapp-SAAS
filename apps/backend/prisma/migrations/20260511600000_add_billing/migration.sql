ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "plan_started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "plan_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "billing_email" TEXT;

CREATE TABLE IF NOT EXISTS "billing_invoices" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "amount"      DOUBLE PRECISION NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'USD',
  "status"      TEXT NOT NULL DEFAULT 'PAID',
  "description" TEXT NOT NULL,
  "period"      TEXT NOT NULL,
  "paid_at"     TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "billing_invoices_tenant_id_idx" ON "billing_invoices"("tenant_id");

ALTER TABLE "billing_invoices"
  ADD CONSTRAINT "billing_invoices_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
