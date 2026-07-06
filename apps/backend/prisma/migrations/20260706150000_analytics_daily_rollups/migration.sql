-- Analytics: indexed date-range filtering on existing hot tables
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_created_at_idx" ON "conversations"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_resolved_at_idx" ON "conversations"("tenant_id", "resolved_at");
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_assigned_to_id_resolved_at_idx" ON "conversations"("tenant_id", "assigned_to_id", "resolved_at");
CREATE INDEX IF NOT EXISTS "payments_tenant_id_created_at_idx" ON "payments"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "payments_tenant_id_verified_at_idx" ON "payments"("tenant_id", "verified_at");

-- Analytics: daily rollup tables (populated by a scheduled worker job)
CREATE TABLE IF NOT EXISTS "analytics_daily_message_stats" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "inbound_count" INTEGER NOT NULL DEFAULT 0,
    "outbound_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_daily_message_stats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_daily_message_stats_tenant_id_date_key" ON "analytics_daily_message_stats"("tenant_id", "date");
CREATE INDEX IF NOT EXISTS "analytics_daily_message_stats_tenant_id_date_idx" ON "analytics_daily_message_stats"("tenant_id", "date");
ALTER TABLE "analytics_daily_message_stats" ADD CONSTRAINT "analytics_daily_message_stats_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "analytics_daily_conversation_stats" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "new_conversations" INTEGER NOT NULL DEFAULT 0,
    "returning_conversations" INTEGER NOT NULL DEFAULT 0,
    "opened_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_daily_conversation_stats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_daily_conversation_stats_tenant_id_date_key" ON "analytics_daily_conversation_stats"("tenant_id", "date");
CREATE INDEX IF NOT EXISTS "analytics_daily_conversation_stats_tenant_id_date_idx" ON "analytics_daily_conversation_stats"("tenant_id", "date");
ALTER TABLE "analytics_daily_conversation_stats" ADD CONSTRAINT "analytics_daily_conversation_stats_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "analytics_daily_revenue_stats" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_daily_revenue_stats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_daily_revenue_stats_tenant_id_date_gateway_key" ON "analytics_daily_revenue_stats"("tenant_id", "date", "gateway");
CREATE INDEX IF NOT EXISTS "analytics_daily_revenue_stats_tenant_id_date_idx" ON "analytics_daily_revenue_stats"("tenant_id", "date");
ALTER TABLE "analytics_daily_revenue_stats" ADD CONSTRAINT "analytics_daily_revenue_stats_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
