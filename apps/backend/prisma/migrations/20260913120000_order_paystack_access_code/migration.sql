-- AlterTable
ALTER TABLE "commerce_orders" ADD COLUMN "paystack_access_code" TEXT;

-- CreateIndex
CREATE INDEX "commerce_orders_paystack_reference_idx" ON "commerce_orders"("paystack_reference");
