-- Commerce AI evaluation harness: EvaluationRun/EvaluationCase, plus
-- Contact.isEvalContact / Order.isEvalOrder isolation flags. See implementation plan.

-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvaluationVerdict" AS ENUM ('PENDING', 'PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "EvaluationCaseStatus" AS ENUM ('PASSED', 'FAILED', 'SKIPPED', 'ERRORED');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "is_eval_contact" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "commerce_orders" ADD COLUMN     "is_eval_order" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "commerce_evaluation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "triggered_by_user_id" TEXT,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "overall_verdict" "EvaluationVerdict" NOT NULL DEFAULT 'PENDING',
    "critical_failure" BOOLEAN NOT NULL DEFAULT false,
    "scenario_count" INTEGER NOT NULL,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "criteria_summary" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_evaluation_cases" (
    "id" TEXT NOT NULL,
    "evaluation_run_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "scenario_key" TEXT NOT NULL,
    "criteria" TEXT[],
    "status" "EvaluationCaseStatus" NOT NULL,
    "contact_id" TEXT,
    "conversation_id" TEXT,
    "order_id" TEXT,
    "transcript" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "failure_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_evaluation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commerce_evaluation_runs_tenant_id_idx" ON "commerce_evaluation_runs"("tenant_id");

-- CreateIndex
CREATE INDEX "commerce_evaluation_runs_tenant_id_created_at_idx" ON "commerce_evaluation_runs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "commerce_evaluation_cases_evaluation_run_id_idx" ON "commerce_evaluation_cases"("evaluation_run_id");

-- CreateIndex
CREATE INDEX "commerce_evaluation_cases_tenant_id_created_at_idx" ON "commerce_evaluation_cases"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "commerce_orders_tenant_id_is_eval_order_idx" ON "commerce_orders"("tenant_id", "is_eval_order");

-- AddForeignKey
ALTER TABLE "commerce_evaluation_runs" ADD CONSTRAINT "commerce_evaluation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_evaluation_runs" ADD CONSTRAINT "commerce_evaluation_runs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_evaluation_cases" ADD CONSTRAINT "commerce_evaluation_cases_evaluation_run_id_fkey" FOREIGN KEY ("evaluation_run_id") REFERENCES "commerce_evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_evaluation_cases" ADD CONSTRAINT "commerce_evaluation_cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

