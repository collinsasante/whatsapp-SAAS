-- Update Starter plan from GHS 240/2400 to GHS 200/2000 ($16/yr $160 at 12.5 rate)
UPDATE "plans"
SET "monthly_price" = 200, "yearly_price" = 2000
WHERE "slug" = 'starter';
