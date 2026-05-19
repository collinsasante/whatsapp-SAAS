-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('BUG', 'FEATURE_REQUEST', 'GENERAL', 'BILLING');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REVIEWED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "feedback" (
    "id"         TEXT NOT NULL,
    "tenant_id"  TEXT NOT NULL,
    "user_id"    TEXT,
    "type"       "FeedbackType" NOT NULL,
    "subject"    TEXT,
    "body"       TEXT NOT NULL,
    "rating"     INTEGER,
    "page"       TEXT,
    "status"     "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_tenant_id_idx" ON "feedback"("tenant_id");
CREATE INDEX "feedback_type_idx"      ON "feedback"("type");
CREATE INDEX "feedback_status_idx"    ON "feedback"("status");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
