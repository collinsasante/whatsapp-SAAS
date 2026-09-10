-- AI Learning & Evaluation System. Purely additive: 5 new tables, 6 new
-- enums, all nullable/defaulted foreign keys onto existing tables. No column
-- on any pre-existing table is touched.

-- CreateEnum
CREATE TYPE "EvalQualityStatus" AS ENUM ('PENDING', 'EVALUATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "FailureCategory" AS ENUM ('WRONG_INFORMATION', 'WRONG_PRODUCT', 'WRONG_PRICE', 'WRONG_QUANTITY', 'WRONG_SIZE', 'WRONG_COLOUR', 'WRONG_ORDER_STATE', 'WRONG_PAYMENT_STATE', 'WRONG_DELIVERY_STATE', 'MISUNDERSTOOD_INTENT', 'LOST_CONTEXT', 'UNNECESSARY_HANDOFF', 'FAILED_HANDOFF', 'WRONG_TOOL', 'TOOL_FAILURE', 'TOOL_RESULT_MISINTERPRETATION', 'UNNECESSARY_QUESTION', 'REPEATED_QUESTION', 'ROBOTIC_RESPONSE', 'TOO_VERBOSE', 'TOO_SHORT', 'CUSTOMER_CORRECTION', 'FALSE_ACTION_CLAIM', 'FALSE_SUCCESS_CLAIM', 'FUTURE_INTENT_MISINTERPRETED', 'MULTI_INTENT_FAILURE', 'TOPIC_SWITCH_FAILURE', 'TIMEOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "FailureSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TakeoverClassification" AS ENUM ('AI_FAILED', 'HUMAN_REQUIRED', 'CUSTOMER_REQUESTED_HUMAN', 'OPERATIONAL_REASON', 'NOT_A_FAILURE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CorrectionCategory" AS ENUM ('CUSTOMER_CORRECTION', 'CLARIFICATION', 'NORMAL_FOLLOW_UP', 'NOT_RELATED');

-- CreateEnum
CREATE TYPE "TrainingExampleStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ai_interaction_evaluations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT,
    "ai_execution_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "status" "EvalQualityStatus" NOT NULL DEFAULT 'PENDING',
    "overall_score" DOUBLE PRECISION,
    "dimensions" JSONB,
    "failure_categories" "FailureCategory"[] DEFAULT ARRAY[]::"FailureCategory"[],
    "severity" "FailureSeverity",
    "evaluator_reasoning" TEXT,
    "evaluator_confidence" DOUBLE PRECISION,
    "needs_human_review" BOOLEAN NOT NULL DEFAULT false,
    "false_action_claim" BOOLEAN NOT NULL DEFAULT false,
    "false_success_claim" BOOLEAN NOT NULL DEFAULT false,
    "unnecessary_handoff" BOOLEAN NOT NULL DEFAULT false,
    "customer_correction_detected" BOOLEAN NOT NULL DEFAULT false,
    "human_takeover_followed" BOOLEAN NOT NULL DEFAULT false,
    "takeover_classification" "TakeoverClassification",
    "prompt_version_id" TEXT,
    "evaluation_source" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "evaluated_at" TIMESTAMP(3),
    "evaluation_error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_interaction_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_feedback" (
    "id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "expected_action" TEXT,
    "expected_response" TEXT,
    "takeover_classification" "TakeoverClassification",
    "correction_category" "CorrectionCategory",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_evaluation_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_training_examples" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_evaluation_id" TEXT NOT NULL,
    "source_conversation_id" TEXT NOT NULL,
    "source_message_id" TEXT,
    "customer_input" TEXT NOT NULL,
    "relevant_context" JSONB,
    "actual_response" TEXT NOT NULL,
    "expected_action" TEXT,
    "expected_response" TEXT,
    "failure_categories" "FailureCategory"[] DEFAULT ARRAY[]::"FailureCategory"[],
    "reviewer_notes" TEXT,
    "status" "TrainingExampleStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "regression_case_created" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_training_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_customer_corrections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "correction_message_id" TEXT NOT NULL,
    "category" "CorrectionCategory" NOT NULL DEFAULT 'NORMAL_FOLLOW_UP',
    "reviewer_id" TEXT,
    "reviewer_notes" TEXT,
    "expected_interpretation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_customer_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_learning_audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "previous_state" JSONB,
    "new_state" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_learning_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_interaction_evaluations_ai_execution_id_key" ON "ai_interaction_evaluations"("ai_execution_id");

-- CreateIndex
CREATE INDEX "ai_interaction_evaluations_tenant_id_created_at_idx" ON "ai_interaction_evaluations"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_interaction_evaluations_tenant_id_status_idx" ON "ai_interaction_evaluations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ai_interaction_evaluations_tenant_id_severity_idx" ON "ai_interaction_evaluations"("tenant_id", "severity");

-- CreateIndex
CREATE INDEX "ai_interaction_evaluations_conversation_id_idx" ON "ai_interaction_evaluations"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_feedback_evaluation_id_key" ON "ai_evaluation_feedback"("evaluation_id");

-- CreateIndex
CREATE INDEX "ai_evaluation_feedback_tenant_id_idx" ON "ai_evaluation_feedback"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_training_examples_tenant_id_status_idx" ON "ai_training_examples"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ai_customer_corrections_tenant_id_idx" ON "ai_customer_corrections"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_learning_audit_logs_tenant_id_created_at_idx" ON "ai_learning_audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_learning_audit_logs_target_type_target_id_idx" ON "ai_learning_audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "ai_interaction_evaluations" ADD CONSTRAINT "ai_interaction_evaluations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interaction_evaluations" ADD CONSTRAINT "ai_interaction_evaluations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interaction_evaluations" ADD CONSTRAINT "ai_interaction_evaluations_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_feedback" ADD CONSTRAINT "ai_evaluation_feedback_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "ai_interaction_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_feedback" ADD CONSTRAINT "ai_evaluation_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_feedback" ADD CONSTRAINT "ai_evaluation_feedback_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_training_examples" ADD CONSTRAINT "ai_training_examples_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_training_examples" ADD CONSTRAINT "ai_training_examples_source_evaluation_id_fkey" FOREIGN KEY ("source_evaluation_id") REFERENCES "ai_interaction_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_training_examples" ADD CONSTRAINT "ai_training_examples_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_customer_corrections" ADD CONSTRAINT "ai_customer_corrections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_customer_corrections" ADD CONSTRAINT "ai_customer_corrections_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "ai_interaction_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_customer_corrections" ADD CONSTRAINT "ai_customer_corrections_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_learning_audit_logs" ADD CONSTRAINT "ai_learning_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
