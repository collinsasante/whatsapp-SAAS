export interface NormalizedAmount {
  amountGhs: number;
  originalAmount: number;
  originalCurrency: string;
  isEstimated: boolean;
}

/**
 * Normalizes an amount in any currency to GHS using a same-day rate lookup
 * (currency -> rate-to-GHS). GHS itself is always exact (rate 1, never
 * estimated); every other currency is flagged `isEstimated: true` since the
 * rate comes from a stored daily configured rate, not a live market feed --
 * see CurrencyRate.isEstimated.
 */
export function normalizeToGhs(
  amount: number,
  currency: string,
  ratesToGhs: Record<string, number>,
): NormalizedAmount {
  if (currency === 'GHS') {
    return { amountGhs: amount, originalAmount: amount, originalCurrency: currency, isEstimated: false };
  }
  const rate = ratesToGhs[currency];
  if (rate == null) {
    throw new Error(`No GHS rate available for currency "${currency}"`);
  }
  return { amountGhs: amount * rate, originalAmount: amount, originalCurrency: currency, isEstimated: true };
}
