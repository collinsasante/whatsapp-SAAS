-- Hide old multi-tier plans from public listing (keep for existing subscribers)
UPDATE "billing_plans" SET "is_public" = false WHERE "slug" IN ('starter', 'growth', 'enterprise');

-- Insert single "pro" plan (idempotent)
INSERT INTO "billing_plans" (
  "id", "slug", "name", "description",
  "monthly_price", "yearly_price", "currency",
  "trial_days",
  "lim_max_agents", "lim_max_channels", "lim_max_contacts",
  "lim_max_templates", "lim_messages_per_month",
  "lim_max_campaigns", "lim_ai_credits_per_month", "lim_storage_gb",
  "features", "sort_order", "updated_at"
) VALUES (
  gen_random_uuid(), 'pro', 'Pro', 'Everything you need to grow with WhatsApp',
  150, 1500, 'GHS',
  7,
  20, 5, 20000,
  -1, -1,
  -1, -1, 20,
  '["5 WhatsApp Channels","20,000 Contacts","Unlimited Messages","20 Agents","Unlimited Templates","Campaigns","Automation","Verz AI Assistant","Knowledge Base","Analytics","7-day Trial"]',
  1, NOW()
)
ON CONFLICT ("slug") DO NOTHING;
