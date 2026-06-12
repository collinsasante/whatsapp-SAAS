-- Prices must be stored in USD — the frontend multiplies by GHS_RATE (12.5) for display.
-- Previous migrations stored 200/2000 GHS directly, causing double-conversion (×12.5 again).
-- Free: $0, Starter: $16/mo $160/yr, Pro: $25/mo $250/yr
UPDATE "billing_plans" SET "monthly_price" = 0,  "yearly_price" = 0,   "updated_at" = NOW() WHERE "slug" = 'free';
UPDATE "billing_plans" SET "monthly_price" = 16, "yearly_price" = 160, "updated_at" = NOW() WHERE "slug" = 'starter';
UPDATE "billing_plans" SET "monthly_price" = 25, "yearly_price" = 250, "updated_at" = NOW() WHERE "slug" = 'pro';
