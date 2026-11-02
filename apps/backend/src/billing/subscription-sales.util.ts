/**
 * Monthly subscription sales are switched off for now. This is a presentation and purchase switch only: subscriptions, plans,
 * invoices, webhooks, renewals and plan limits for existing workspaces all keep working. When off:
 *  - the plan list is empty and no plan price reaches a customer-facing response;
 *  - subscription checkout, promo codes and trials are refused.
 * AI credit purchases, credit balances and Commerce payments are not affected by it.
 * Set SUBSCRIPTION_SALES_ENABLED=true to bring the plan list and subscription checkout back.
 */
export const SUBSCRIPTION_SALES_ENV = 'SUBSCRIPTION_SALES_ENABLED';

export const SUBSCRIPTIONS_UNAVAILABLE_CODE = 'SUBSCRIPTIONS_UNAVAILABLE';
export const SUBSCRIPTIONS_UNAVAILABLE_MESSAGE = 'Subscription plans are not available right now.';

export function isSubscriptionSalesEnabled(read: (key: string) => string | undefined): boolean {
  return read(SUBSCRIPTION_SALES_ENV)?.trim().toLowerCase() === 'true';
}

/** Everything that states what a plan costs or how it is charged. Entitlements (limits, name, features) are not in this list. */
const PRICING_FIELDS = [
  'monthlyPrice', 'yearlyPrice', 'currency', 'ghsMonthlyPrice', 'ghsYearlyPrice',
  'stripePriceIdMonthly', 'stripePriceIdYearly', 'paystackPlanCodeMonthly', 'paystackPlanCodeYearly',
] as const;

export type WithoutPlanPricing<T> = Omit<T, (typeof PRICING_FIELDS)[number]>;

/** A copy of the plan without any price or gateway identifier. The stored plan is never changed. */
export function withoutPlanPricing<T extends object>(plan: T): WithoutPlanPricing<T> {
  const copy: Record<string, unknown> = { ...(plan as Record<string, unknown>) };
  for (const field of PRICING_FIELDS) delete copy[field];
  return copy as WithoutPlanPricing<T>;
}
