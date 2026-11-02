import { isSubscriptionSalesEnabled, withoutPlanPricing } from './subscription-sales.util';

describe('isSubscriptionSalesEnabled', () => {
  it.each([undefined, '', 'false', 'FALSE', '0', 'yes', '1', 'enabled'])('is off for %p (only the word "true" switches it on)', (value) => {
    expect(isSubscriptionSalesEnabled(() => value)).toBe(false);
  });

  it.each(['true', 'TRUE', ' true '])('is on for %p', (value) => {
    expect(isSubscriptionSalesEnabled(() => value)).toBe(true);
  });

  it('reads the documented variable', () => {
    const read = jest.fn().mockReturnValue(undefined);
    isSubscriptionSalesEnabled(read);
    expect(read).toHaveBeenCalledWith('SUBSCRIPTION_SALES_ENABLED');
  });
});

describe('withoutPlanPricing', () => {
  const plan = {
    id: 'p1', slug: 'pro', name: 'Pro', description: 'x', isActive: true, trialDays: 7,
    monthlyPrice: 25, yearlyPrice: 250, currency: 'USD', ghsMonthlyPrice: 300, ghsYearlyPrice: 3000,
    stripePriceIdMonthly: 'price_m', stripePriceIdYearly: 'price_y', paystackPlanCodeMonthly: 'PLN_m', paystackPlanCodeYearly: 'PLN_y',
    limMaxAgents: 20, limMaxChannels: 5, limMaxContacts: 20000, limAiCreditsPerMonth: 0, features: ['inbox'],
  };

  it('removes every price, currency and gateway identifier', () => {
    const out = withoutPlanPricing(plan) as Record<string, unknown>;
    for (const field of ['monthlyPrice', 'yearlyPrice', 'currency', 'ghsMonthlyPrice', 'ghsYearlyPrice', 'stripePriceIdMonthly', 'stripePriceIdYearly', 'paystackPlanCodeMonthly', 'paystackPlanCodeYearly']) {
      expect(out).not.toHaveProperty(field);
    }
    expect(JSON.stringify(out)).not.toMatch(/25|250|300|3000|price_|PLN_|USD/);
  });

  it('keeps what the workspace is entitled to: name, status flags, limits and features', () => {
    expect(withoutPlanPricing(plan)).toMatchObject({ id: 'p1', slug: 'pro', name: 'Pro', isActive: true, trialDays: 7, limMaxAgents: 20, limMaxChannels: 5, limMaxContacts: 20000, features: ['inbox'] });
  });

  it('returns a copy and never changes the stored plan', () => {
    const before = JSON.stringify(plan);
    withoutPlanPricing(plan);
    expect(JSON.stringify(plan)).toBe(before);
  });
});
