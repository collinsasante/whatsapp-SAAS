/**
 * The price used to RESERVE and to SETTLE AI Learning provider cost. Platform-funded, in micro-USD (1 USD = 1_000_000), integers only.
 *
 * Rates are DeepSeek's published PEAK, CACHE-MISS rates for `deepseek-flash` (the legacy alias `deepseek-v4-flash`, which this phase
 * keeps using, is served at the same price). Peak and cache-miss are the highest published tier, so a reservation can only be
 * higher than the bill, never lower. Prices change: when DeepSeek's page changes, edit this table, bump `version`, update
 * `verifiedAt`, and re-run the pricing tests. The version is stored on every ledger row so past cost stays explainable.
 *
 * The model catalogue's own rates (ai-core/models/model-catalog.ts: 0.14 / 0.28) are older and lower; they are NOT used here.
 */
export interface LearningPriceTable {
  readonly version: string;
  readonly verifiedAt: string;
  readonly source: string;
  readonly basis: string;
  readonly inputMicrosPerMillionTokens: number;
  readonly outputMicrosPerMillionTokens: number;
}

export const LEARNING_PRICE_TABLE: LearningPriceTable = {
  version: '2026-11-02.deepseek-flash.peak-cache-miss',
  verifiedAt: '2026-11-02',
  source: 'https://api-docs.deepseek.com/quick_start/pricing',
  basis: 'peak hours, cache miss',
  inputMicrosPerMillionTokens: 300_000, // USD 0.30 per 1M input tokens
  outputMicrosPerMillionTokens: 1_200_000, // USD 1.20 per 1M output tokens
};

/** Cost of a known token count, rounded UP to a whole micro-USD (never under-counts). */
export function costMicros(inputTokens: number, outputTokens: number, table: LearningPriceTable = LEARNING_PRICE_TABLE): bigint {
  const safe = (n: number): bigint => BigInt(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const numerator = safe(inputTokens) * BigInt(table.inputMicrosPerMillionTokens) + safe(outputTokens) * BigInt(table.outputMicrosPerMillionTokens);
  return (numerator + 999_999n) / 1_000_000n;
}
