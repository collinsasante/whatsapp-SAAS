INSERT INTO "billing_plans" (
  "id", "slug", "name", "description",
  "monthly_price", "yearly_price", "currency",
  "trial_days",
  "lim_max_agents", "lim_max_channels", "lim_max_contacts",
  "lim_max_templates", "lim_messages_per_month",
  "lim_max_campaigns", "lim_ai_credits_per_month", "lim_storage_gb",
  "features", "is_active", "is_public", "sort_order",
  "created_at", "updated_at"
)
VALUES (
  gen_random_uuid(), 'free', 'Free', 'Get started with the basics, no credit card needed',
  0, 0, 'GHS',
  0,
  1, 1, 100,
  5, 500,
  0, 0, 1,
  '["1 WhatsApp Channel","100 Contacts","500 Messages/month","1 Agent","5 Templates"]',
  true, true, -1,
  NOW(), NOW()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name"                      = EXCLUDED."name",
  "description"               = EXCLUDED."description",
  "monthly_price"             = EXCLUDED."monthly_price",
  "yearly_price"              = EXCLUDED."yearly_price",
  "lim_max_agents"            = EXCLUDED."lim_max_agents",
  "lim_max_channels"          = EXCLUDED."lim_max_channels",
  "lim_max_contacts"          = EXCLUDED."lim_max_contacts",
  "lim_max_templates"         = EXCLUDED."lim_max_templates",
  "lim_messages_per_month"    = EXCLUDED."lim_messages_per_month",
  "lim_max_campaigns"         = EXCLUDED."lim_max_campaigns",
  "lim_ai_credits_per_month"  = EXCLUDED."lim_ai_credits_per_month",
  "lim_storage_gb"            = EXCLUDED."lim_storage_gb",
  "features"                  = EXCLUDED."features",
  "is_active"                 = EXCLUDED."is_active",
  "is_public"                 = EXCLUDED."is_public",
  "sort_order"                = EXCLUDED."sort_order",
  "updated_at"                = NOW();
