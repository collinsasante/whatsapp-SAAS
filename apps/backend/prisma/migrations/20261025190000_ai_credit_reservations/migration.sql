BEGIN;

CREATE TYPE "AiCreditReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED', 'EXPIRED');

CREATE TABLE "ai_credit_reservations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ai_execution_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "reserved_credits" INTEGER NOT NULL,
    "settled_credits" INTEGER,
    "max_credits_per_attempt" INTEGER NOT NULL,
    "pricing_credits_per_usd" DOUBLE PRECISION NOT NULL,
    "pricing_input_cost_per_million_usd" DOUBLE PRECISION NOT NULL,
    "pricing_output_cost_per_million_usd" DOUBLE PRECISION NOT NULL,
    "status" "AiCreditReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_credit_reservations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_credit_transactions" ADD COLUMN "reservation_id" TEXT;

CREATE UNIQUE INDEX "ai_credit_transactions_reservation_id_key" ON "ai_credit_transactions"("reservation_id");
CREATE UNIQUE INDEX "ai_credit_reservations_tenant_id_idempotency_key_key"
    ON "ai_credit_reservations"("tenant_id", "idempotency_key");
CREATE INDEX "ai_credit_reservations_tenant_id_status_idx"
    ON "ai_credit_reservations"("tenant_id", "status");
CREATE INDEX "ai_credit_reservations_status_expires_at_idx"
    ON "ai_credit_reservations"("status", "expires_at");

ALTER TABLE "ai_credit_reservations"
    ADD CONSTRAINT "ai_credit_reservations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_reservations"
    ADD CONSTRAINT "ai_credit_reservations_ai_execution_id_fkey"
    FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_credit_transactions"
    ADD CONSTRAINT "ai_credit_transactions_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "ai_credit_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
