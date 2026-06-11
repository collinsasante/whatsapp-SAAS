-- Update Starter plan from GHS 240/2400 to GHS 200/2000 ($16 x 12.5 rate)
UPDATE "billing_plans"
SET "monthly_price" = 200, "yearly_price" = 2000
WHERE "slug" = 'starter';
