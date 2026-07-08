-- Platform admin: date-only indexes so cross-tenant aggregation (GROUP BY date,
-- no tenant filter) doesn't have to scan every tenant-prefixed index entry.
CREATE INDEX IF NOT EXISTS "analytics_daily_message_stats_date_idx" ON "analytics_daily_message_stats"("date");
CREATE INDEX IF NOT EXISTS "analytics_daily_conversation_stats_date_idx" ON "analytics_daily_conversation_stats"("date");
CREATE INDEX IF NOT EXISTS "analytics_daily_revenue_stats_date_idx" ON "analytics_daily_revenue_stats"("date");

-- Daily FX rate table (normalizes multi-currency/multi-gateway revenue to GHS)
CREATE TABLE IF NOT EXISTS "currency_rates" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "rate_to_ghs" DOUBLE PRECISION NOT NULL,
    "is_estimated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "currency_rates_date_currency_key" ON "currency_rates"("date", "currency");

-- MRR movement category enum
CREATE TYPE "MrrMovementCategory" AS ENUM ('NEW', 'EXPANSION', 'CONTRACTION', 'CHURNED', 'RETAINED', 'NONE');

-- Per-tenant-per-day MRR snapshot (drives both the aggregate MRR-movement strip
-- and "which tenants moved it" drill-down)
CREATE TABLE IF NOT EXISTS "platform_tenant_mrr_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mrr_ghs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "category" "MrrMovementCategory" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_tenant_mrr_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_tenant_mrr_snapshots_tenant_id_date_key" ON "platform_tenant_mrr_snapshots"("tenant_id", "date");
CREATE INDEX IF NOT EXISTS "platform_tenant_mrr_snapshots_date_category_idx" ON "platform_tenant_mrr_snapshots"("date", "category");
ALTER TABLE "platform_tenant_mrr_snapshots" ADD CONSTRAINT "platform_tenant_mrr_snapshots_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Platform-wide daily snapshot: tenant/subscription lifecycle counts, MRR/ARR, DAU/WAU/MAU
CREATE TABLE IF NOT EXISTS "platform_daily_stats" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total_tenants" INTEGER NOT NULL DEFAULT 0,
    "active_tenants" INTEGER NOT NULL DEFAULT 0,
    "new_tenants" INTEGER NOT NULL DEFAULT 0,
    "trial_tenants" INTEGER NOT NULL DEFAULT 0,
    "active_subscriptions" INTEGER NOT NULL DEFAULT 0,
    "past_due_subscriptions" INTEGER NOT NULL DEFAULT 0,
    "trials_converted" INTEGER NOT NULL DEFAULT 0,
    "churned_tenants" INTEGER NOT NULL DEFAULT 0,
    "mrr_ghs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "arr_ghs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dau" INTEGER NOT NULL DEFAULT 0,
    "wau" INTEGER NOT NULL DEFAULT 0,
    "mau" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_daily_stats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_daily_stats_date_key" ON "platform_daily_stats"("date");
