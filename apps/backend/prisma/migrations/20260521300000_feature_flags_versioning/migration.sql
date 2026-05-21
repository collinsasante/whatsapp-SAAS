-- Feature Flags
CREATE TABLE "feature_flags" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "rollout_type" TEXT NOT NULL DEFAULT 'all',
  "rollout_pct" INTEGER NOT NULL DEFAULT 100,
  "beta_tenants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "environment" TEXT NOT NULL DEFAULT 'all',
  "kill_switch" BOOLEAN NOT NULL DEFAULT false,
  "category" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- Feature Flag Rollouts (per-tenant overrides)
CREATE TABLE "feature_flag_rollouts" (
  "id" TEXT NOT NULL,
  "flag_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feature_flag_rollouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "feature_flag_rollouts_flag_id_tenant_id_key" ON "feature_flag_rollouts"("flag_id", "tenant_id");
CREATE INDEX "feature_flag_rollouts_tenant_id_idx" ON "feature_flag_rollouts"("tenant_id");
ALTER TABLE "feature_flag_rollouts" ADD CONSTRAINT "feature_flag_rollouts_flag_id_fkey"
  FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feature_flag_rollouts" ADD CONSTRAINT "feature_flag_rollouts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- App Versions
CREATE TABLE "app_versions" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "major" INTEGER NOT NULL,
  "minor" INTEGER NOT NULL,
  "patch" INTEGER NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'stable',
  "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "changelog" JSONB,
  "is_latest" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "app_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_versions_version_key" ON "app_versions"("version");

-- Deployment Logs
CREATE TABLE "deployment_logs" (
  "id" TEXT NOT NULL,
  "version_id" TEXT,
  "version" TEXT NOT NULL,
  "commit_hash" TEXT,
  "branch" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "deployed_by" TEXT,
  "status" TEXT NOT NULL DEFAULT 'success',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "notes" TEXT,
  "build_duration" INTEGER,
  CONSTRAINT "deployment_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "deployment_logs_environment_idx" ON "deployment_logs"("environment");
CREATE INDEX "deployment_logs_started_at_idx" ON "deployment_logs"("started_at");
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "app_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed initial version
INSERT INTO "app_versions" ("id", "version", "major", "minor", "patch", "channel", "description", "is_latest", "changelog")
VALUES (
  'ver_2_0_0',
  '2.0.0',
  2, 0, 0,
  'stable',
  'VerzChat v2 — Email verification, 2FA, knowledge base file uploads, mobile responsive layout',
  true,
  '{"features":["Email verification on signup","2-step authentication via email OTP","Knowledge base file upload (PDF, TXT, CSV, MD)","URL scraping for knowledge base","Mobile-responsive campaigns, dashboard, and inbox","Real-time dashboard KPI cards via WebSocket","Always-visible message read receipts"],"fixes":["Welcome message now fires correctly for contacts with prior outbound messages","Dashboard KPI cards update in real-time"],"breaking":[]}'
);
