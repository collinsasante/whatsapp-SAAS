-- Fix Starter plan price: GHS 200/month, GHS 2000/year ($16 x 12.5 rate)
UPDATE "billing_plans"
SET "monthly_price" = 200, "yearly_price" = 2000, "updated_at" = NOW()
WHERE "slug" = 'starter';
