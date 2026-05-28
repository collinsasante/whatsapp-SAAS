-- Campaign click tracking: add tracking_url + click_count to campaigns,
-- and a campaign_clicks table for per-link click events.
ALTER TABLE "campaigns"
  ADD COLUMN "tracking_url" TEXT,
  ADD COLUMN "click_count"  INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "campaign_clicks" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id" UUID        NOT NULL,
  "contact_id"  UUID,
  "code"        TEXT        NOT NULL,
  "clicked_at"  TIMESTAMPTZ,
  "user_agent"  TEXT,
  "ip"          TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "campaign_clicks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "campaign_clicks_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "campaign_clicks_code_key" ON "campaign_clicks"("code");
CREATE INDEX "campaign_clicks_campaign_id_idx" ON "campaign_clicks"("campaign_id");
CREATE INDEX "campaign_clicks_code_idx" ON "campaign_clicks"("code");
