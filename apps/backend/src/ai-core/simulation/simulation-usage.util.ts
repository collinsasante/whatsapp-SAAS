import { estimateCostUsd } from '../models/model-catalog';

export interface SimulatedExecutionRow {
  modelKey: string;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** A cost the recorder itself stored (v2 and Commerce record one). */
  estCostUsd: number | null;
}

export interface SimulatedUsageSummary {
  calls: number;
  succeeded: number;
  /** Exactly as the provider reported them, summed over the calls that reported them. */
  inputTokens: number;
  outputTokens: number;
  /** Calls with no reported token counts: they are in `calls` but contribute nothing here, and nothing is guessed for them. */
  callsWithoutTokenCounts: number;
  /** An ESTIMATE, not an invoice: a stored cost where the recorder stored one, otherwise the model catalog's rates applied to the reported tokens. */
  estimatedCostUsd: number;
  /** False when some calls could not be priced (no tokens, or a model missing from the catalog), so the figure is a floor. */
  costEstimateComplete: boolean;
  costBasis: string;
}

const COST_BASIS = 'Model-catalog rates (code constants applied to provider-reported tokens). Not verified against the provider\'s current price list.';

export function estimateSimulatedUsage(rows: SimulatedExecutionRow[]): SimulatedUsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let withoutTokens = 0;
  let complete = true;
  let succeeded = 0;
  for (const r of rows) {
    if (r.status === 'SUCCESS') succeeded++;
    const hasTokens = r.inputTokens !== null && r.outputTokens !== null;
    if (r.inputTokens !== null) inputTokens += r.inputTokens;
    if (r.outputTokens !== null) outputTokens += r.outputTokens;
    if (!hasTokens) withoutTokens++;
    if (r.estCostUsd !== null && Number.isFinite(r.estCostUsd)) { cost += r.estCostUsd; continue; }
    if (!hasTokens) { complete = false; continue; }
    try { cost += estimateCostUsd(r.modelKey, r.inputTokens!, r.outputTokens!); }
    catch { complete = false; } // a model the catalog does not know: unpriced, not guessed
  }
  return {
    calls: rows.length, succeeded, inputTokens, outputTokens, callsWithoutTokenCounts: withoutTokens,
    estimatedCostUsd: Number(cost.toFixed(6)), costEstimateComplete: complete, costBasis: COST_BASIS,
  };
}
