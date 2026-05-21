-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM (
  'SCHEDULED', 'INITIATED', 'RINGING', 'ANSWERED',
  'MISSED', 'FAILED', 'COMPLETED', 'CANCELLED'
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id"           TEXT NOT NULL,
    "tenant_id"    TEXT NOT NULL,
    "contact_id"   TEXT NOT NULL,
    "user_id"      TEXT,
    "direction"    "CallDirection" NOT NULL,
    "status"       "CallStatus"   NOT NULL DEFAULT 'INITIATED',
    "duration"     INTEGER,
    "notes"        TEXT,
    "metadata"     JSONB NOT NULL DEFAULT '{}',
    "scheduled_at" TIMESTAMP(3),
    "started_at"   TIMESTAMP(3),
    "answered_at"  TIMESTAMP(3),
    "ended_at"     TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_logs_tenant_id_created_at_idx" ON "call_logs"("tenant_id", "created_at");
CREATE INDEX "call_logs_tenant_id_contact_id_idx" ON "call_logs"("tenant_id", "contact_id");

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
