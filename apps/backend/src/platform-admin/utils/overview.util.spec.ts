import { computeNetRevenueRetention, computeLogoChurnRate, computeArpu, computeTrialConversionRate } from './overview.util';

describe('computeNetRevenueRetention', () => {
  it('returns exactly 100% when the cohort is perfectly flat', () => {
    expect(computeNetRevenueRetention(1000, 1000)).toBe(100);
  });

  it('returns over 100% when expansion outpaces contraction+churn', () => {
    expect(computeNetRevenueRetention(1000, 1200)).toBe(120);
  });

  it('returns under 100% when contraction+churn outpaces expansion', () => {
    expect(computeNetRevenueRetention(1000, 700)).toBe(70);
  });

  it('returns null when there was no paying cohort to measure against', () => {
    expect(computeNetRevenueRetention(0, 0)).toBeNull();
  });
});

describe('computeLogoChurnRate', () => {
  it('computes the % of the starting cohort that churned', () => {
    expect(computeLogoChurnRate(5, 100)).toBe(5);
  });

  it('returns null when there were no active tenants to churn from', () => {
    expect(computeLogoChurnRate(0, 0)).toBeNull();
  });
});

describe('computeArpu', () => {
  it('divides MRR evenly across paying tenants', () => {
    expect(computeArpu(1000, 20)).toBe(50);
  });

  it('returns 0 when there are no paying tenants (avoids divide-by-zero)', () => {
    expect(computeArpu(0, 0)).toBe(0);
  });
});

describe('computeTrialConversionRate', () => {
  it('computes conversion rate against resolved + still-trialing trials', () => {
    expect(computeTrialConversionRate(3, 7)).toBe(30);
  });

  it('treats an in-progress trial as unresolved, not a failure', () => {
    // 1 converted, 1 still trialing -> 50%, not 1/1=100% or counted as a loss
    expect(computeTrialConversionRate(1, 1)).toBe(50);
  });

  it('returns null when there is nothing to measure', () => {
    expect(computeTrialConversionRate(0, 0)).toBeNull();
  });
});
