-- Managed Commerce Phase 1: single-pilot-tenant outcome-based GMV take-rate commerce.
-- Adds Product/Order/OrderItem/OrderEvent/CommerceLedgerEntry/ReconciliationException plus
-- TenantSettings.commerceEnabled/takeRatePct. See implementation plan for full scope.

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'FULFILLING', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('CREATED', 'ITEM_ADDED', 'SUBMITTED_FOR_PAYMENT', 'PAYMENT_INITIATED', 'PAID', 'FULFILLMENT_UPDATED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('GMV', 'TAKE_RATE', 'REFUND_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "commerce_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "take_rate_pct" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "commerce_products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "price_major_units" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "stock_quantity" INTEGER,
    "variants" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "subtotal_major_units" DOUBLE PRECISION NOT NULL,
    "total_major_units" DOUBLE PRECISION NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_name" TEXT,
    "paystack_reference" TEXT,
    "payment_gateway" "PaymentGateway",
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name_snapshot" TEXT NOT NULL,
    "unit_price_major_units_snapshot" DOUBLE PRECISION NOT NULL,
    "variant_label_snapshot" TEXT,
    "quantity" INTEGER NOT NULL,
    "line_total_major_units" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "commerce_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_order_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" "OrderEventType" NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_ledger_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount_major_units" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "gateway" "PaymentGateway",
    "gateway_event_id" TEXT,
    "data" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_reconciliation_exceptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "expected_amount_major_units" DOUBLE PRECISION,
    "actual_amount_major_units" DOUBLE PRECISION,
    "details" JSONB,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_reconciliation_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commerce_products_tenant_id_idx" ON "commerce_products"("tenant_id");

-- CreateIndex
CREATE INDEX "commerce_products_tenant_id_is_active_idx" ON "commerce_products"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "commerce_orders_tenant_id_idx" ON "commerce_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "commerce_orders_tenant_id_status_idx" ON "commerce_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "commerce_orders_tenant_id_created_at_idx" ON "commerce_orders"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "commerce_orders_contact_id_idx" ON "commerce_orders"("contact_id");

-- CreateIndex
CREATE INDEX "commerce_order_items_order_id_idx" ON "commerce_order_items"("order_id");

-- CreateIndex
CREATE INDEX "commerce_order_events_order_id_idx" ON "commerce_order_events"("order_id");

-- CreateIndex
CREATE INDEX "commerce_order_events_tenant_id_idx" ON "commerce_order_events"("tenant_id");

-- CreateIndex
CREATE INDEX "commerce_ledger_entries_tenant_id_idx" ON "commerce_ledger_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "commerce_ledger_entries_order_id_idx" ON "commerce_ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "commerce_ledger_entries_type_idx" ON "commerce_ledger_entries"("type");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_ledger_entries_order_id_type_gateway_event_id_key" ON "commerce_ledger_entries"("order_id", "type", "gateway_event_id");

-- CreateIndex
CREATE INDEX "commerce_reconciliation_exceptions_tenant_id_status_idx" ON "commerce_reconciliation_exceptions"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "commerce_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_order_events" ADD CONSTRAINT "commerce_order_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_order_events" ADD CONSTRAINT "commerce_order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_ledger_entries" ADD CONSTRAINT "commerce_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_ledger_entries" ADD CONSTRAINT "commerce_ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_reconciliation_exceptions" ADD CONSTRAINT "commerce_reconciliation_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_reconciliation_exceptions" ADD CONSTRAINT "commerce_reconciliation_exceptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_reconciliation_exceptions" ADD CONSTRAINT "commerce_reconciliation_exceptions_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
