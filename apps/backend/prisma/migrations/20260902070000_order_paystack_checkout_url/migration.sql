-- Order.paystackCheckoutUrl: stores Paystack's own authorization_url from
-- initializeTransaction(), fixing a broken checkout link (was being
-- constructed client-side as https://checkout.paystack.com/<reference>,
-- which is not a valid Paystack URL pattern and sent customers to a
-- "we could not start this transaction" error page).
ALTER TABLE "commerce_orders" ADD COLUMN "paystack_checkout_url" TEXT;
