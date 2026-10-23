-- Verz-AI Phase 2b: Internal Tasks + Order Approval Workflow
-- Isolated from unrelated pre-existing schema drift (see this repo's established
-- migration methodology) -- only statements for this feature are included.

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_ASSIGNED';

-- AlterEnum
ALTER TYPE "OrderEventType" ADD VALUE 'SENT_FOR_APPROVAL';
ALTER TYPE "OrderEventType" ADD VALUE 'APPROVED';

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_APPROVAL';

-- AlterTable
ALTER TABLE "commerce_products" ADD COLUMN "min_order_quantity" INTEGER;

-- CreateTable
CREATE TABLE "internal_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "assigned_team_id" TEXT,
    "assignee_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "conversation_id" TEXT,
    "order_id" TEXT,
    "contact_id" TEXT,
    "created_by_id" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "internal_tasks_tenant_id_idx" ON "internal_tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "internal_tasks_tenant_id_status_idx" ON "internal_tasks"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "internal_tasks_tenant_id_assigned_team_id_idx" ON "internal_tasks"("tenant_id", "assigned_team_id");

-- CreateIndex
CREATE INDEX "internal_tasks_order_id_idx" ON "internal_tasks"("order_id");

-- CreateIndex
CREATE INDEX "internal_tasks_conversation_id_idx" ON "internal_tasks"("conversation_id");

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_assigned_team_id_fkey" FOREIGN KEY ("assigned_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
