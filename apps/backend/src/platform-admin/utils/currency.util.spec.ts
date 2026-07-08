import { normalizeToGhs } from './currency.util';

describe('normalizeToGhs', () => {
  it('passes GHS through unchanged and never marks it estimated', () => {
    const result = normalizeToGhs(100, 'GHS', {});
    expect(result).toEqual({ amountGhs: 100, originalAmount: 100, originalCurrency: 'GHS', isEstimated: false });
  });

  it('converts USD using the provided rate and flags it as estimated', () => {
    const result = normalizeToGhs(10, 'USD', { USD: 12.5 });
    expect(result.amountGhs).toBeCloseTo(125, 5);
    expect(result.originalAmount).toBe(10);
    expect(result.originalCurrency).toBe('USD');
    expect(result.isEstimated).toBe(true);
  });

  it('throws when no rate exists for the given currency', () => {
    expect(() => normalizeToGhs(10, 'EUR', { USD: 12.5 })).toThrow('No GHS rate available for currency "EUR"');
  });
});
