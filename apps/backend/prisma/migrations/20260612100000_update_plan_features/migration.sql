-- Update Free plan: unlimited contacts/messages, 1 agent, no templates
UPDATE "billing_plans"
SET
  "lim_max_contacts"       = -1,
  "lim_messages_per_month" = -1,
  "lim_max_agents"         = 1,
  "lim_max_templates"      = 0,
  "lim_max_campaigns"      = 0,
  "features"               = '["1 WhatsApp Channel","Unlimited Contacts","Unlimited Messages/month","1 Agent"]',
  "updated_at"             = NOW()
WHERE "slug" = 'free';

-- Update Starter plan: unlimited contacts/messages, 2 agents, 3 templates, 3 automations
UPDATE "billing_plans"
SET
  "lim_max_contacts"       = -1,
  "lim_messages_per_month" = -1,
  "lim_max_agents"         = 2,
  "lim_max_templates"      = 3,
  "lim_max_campaigns"      = 3,
  "features"               = '["1 WhatsApp Channel","Unlimited Contacts","Unlimited Messages/month","2 Agents","3 Templates","3 Automations"]',
  "updated_at"             = NOW()
WHERE "slug" = 'starter';
