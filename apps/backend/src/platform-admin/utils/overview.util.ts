/**
 * Net Revenue Retention: of the tenants that were already paying at the start
 * of the period, what % of their combined MRR remains at the end -- including
 * expansion and contraction, but excluding any revenue from brand-new tenants.
 * >100% means expansion outpaced contraction+churn within that existing cohort.
 */
export function computeNetRevenueRetention(startCohortMrr: number, endCohortMrr: number): number | null {
  if (startCohortMrr <= 0) return null; // no paying cohort to measure retention against
  return Math.round((endCohortMrr / startCohortMrr) * 1000) / 10;
}

/** % of tenants paying at the start of the period who churned by the end. */
export function computeLogoChurnRate(churnedCount: number, startActiveCount: number): number | null {
  if (startActiveCount <= 0) return null;
  return Math.round((churnedCount / startActiveCount) * 1000) / 10;
}

/** Average revenue per paying tenant. */
export function computeArpu(mrr: number, activePayingTenants: number): number {
  if (activePayingTenants <= 0) return 0;
  return Math.round((mrr / activePayingTenants) * 100) / 100;
}

/**
 * Trial -> paid conversion rate for a period: of the trials that resolved
 * one way or another (converted to paid, or are still mid-trial at period
 * end), what fraction converted. A trial that's still running isn't yet a
 * "no", so it's counted in the denominator, not treated as a failure.
 */
export function computeTrialConversionRate(convertedCount: number, stillInTrialCount: number): number | null {
  const resolved = convertedCount + stillInTrialCount;
  if (resolved <= 0) return null;
  return Math.round((convertedCount / resolved) * 1000) / 10;
}
