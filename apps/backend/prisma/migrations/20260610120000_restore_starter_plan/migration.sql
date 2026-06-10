-- Restore Starter plan as public and update its limits/price
INSERT INTO "billing_plans" (
  "id", "slug", "name", "description",
  "monthly_price", "yearly_price", "currency",
  "trial_days",
  "lim_max_agents", "lim_max_channels", "lim_max_contacts",
  "lim_max_templates", "lim_messages_per_month",
  "lim_max_campaigns", "lim_ai_credits_per_month", "lim_storage_gb",
  "features", "is_active", "is_public", "sort_order", "updated_at"
) VALUES (
  gen_random_uuid(), 'starter', 'Starter', 'Everything you need to get started with WhatsApp',
  240, 2400, 'GHS',
  0,
  3, 1, 5000,
  10, 5000,
  0, 0, 5,
  '["1 WhatsApp Channel","5,000 Contacts","5,000 Messages/month","3 Agents","10 Templates","Automation"]',
  true, true, 0, NOW()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name"                    = 'Starter',
  "description"             = 'Everything you need to get started with WhatsApp',
  "monthly_price"           = 240,
  "yearly_price"            = 2400,
  "currency"                = 'GHS',
  "trial_days"              = 0,
  "lim_max_agents"          = 3,
  "lim_max_channels"        = 1,
  "lim_max_contacts"        = 5000,
  "lim_max_templates"       = 10,
  "lim_messages_per_month"  = 5000,
  "lim_max_campaigns"       = 0,
  "lim_ai_credits_per_month"= 0,
  "lim_storage_gb"          = 5,
  "features"                = '["1 WhatsApp Channel","5,000 Contacts","5,000 Messages/month","3 Agents","10 Templates","Automation"]',
  "is_active"               = true,
  "is_public"               = true,
  "sort_order"              = 0,
  "updated_at"              = NOW();
