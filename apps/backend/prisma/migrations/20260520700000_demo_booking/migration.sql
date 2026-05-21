CREATE TABLE "demo_requests" (
  "id" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "work_email" TEXT NOT NULL,
  "phone_number" TEXT,
  "business_name" TEXT NOT NULL,
  "business_type" TEXT NOT NULL,
  "company_size" TEXT NOT NULL,
  "current_platform" TEXT,
  "preferred_date" TIMESTAMP(3) NOT NULL,
  "preferred_time" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "goals" TEXT,
  "lead_score" INTEGER NOT NULL DEFAULT 0,
  "lead_tier" TEXT NOT NULL DEFAULT 'standard',
  "priority" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'new',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_notes" (
  "id" TEXT NOT NULL,
  "demo_request_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "author_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_status_history" (
  "id" TEXT NOT NULL,
  "demo_request_id" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT NOT NULL,
  "changed_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "demo_requests_status_idx" ON "demo_requests"("status");
CREATE INDEX "demo_requests_work_email_idx" ON "demo_requests"("work_email");
CREATE INDEX "demo_requests_lead_score_idx" ON "demo_requests"("lead_score");
CREATE INDEX "lead_notes_demo_request_id_idx" ON "lead_notes"("demo_request_id");
CREATE INDEX "lead_status_history_demo_request_id_idx" ON "lead_status_history"("demo_request_id");

ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_demo_request_id_fkey"
  FOREIGN KEY ("demo_request_id") REFERENCES "demo_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_demo_request_id_fkey"
  FOREIGN KEY ("demo_request_id") REFERENCES "demo_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
