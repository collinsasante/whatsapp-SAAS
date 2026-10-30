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
  /**
   * Exactly as the provider reported them, summed over the calls that reported them. NULL (not 0) when there were calls but none
   * reported a count: "unknown" must not read as "no usage". 0 only means there were no calls.
   */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Calls with no reported token counts: they are in `calls` but contribute nothing here, and nothing is guessed for them. */
  callsWithoutTokenCounts: number;
  /**
   * An ESTIMATE, not an invoice: a stored cost where the recorder stored one, otherwise the model catalog's rates applied to the reported tokens.
   * NULL (not 0) when there were calls but none could be priced.
   */
  estimatedCostUsd: number | null;
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
  let inputReported = 0;
  let outputReported = 0;
  let priced = 0;
  let complete = true;
  let succeeded = 0;
  for (const r of rows) {
    if (r.status === 'SUCCESS') succeeded++;
    const hasTokens = r.inputTokens !== null && r.outputTokens !== null;
    if (r.inputTokens !== null) { inputTokens += r.inputTokens; inputReported++; }
    if (r.outputTokens !== null) { outputTokens += r.outputTokens; outputReported++; }
    if (!hasTokens) withoutTokens++;
    if (r.estCostUsd !== null && Number.isFinite(r.estCostUsd)) { cost += r.estCostUsd; priced++; continue; }
    if (!hasTokens) { complete = false; continue; }
    try { cost += estimateCostUsd(r.modelKey, r.inputTokens!, r.outputTokens!); priced++; }
    catch { complete = false; } // a model the catalog does not know: unpriced, not guessed
  }
  return {
    calls: rows.length, succeeded,
    inputTokens: rows.length > 0 && inputReported === 0 ? null : inputTokens,
    outputTokens: rows.length > 0 && outputReported === 0 ? null : outputTokens,
    callsWithoutTokenCounts: withoutTokens,
    estimatedCostUsd: rows.length > 0 && priced === 0 ? null : Number(cost.toFixed(6)), costEstimateComplete: complete, costBasis: COST_BASIS,
  };
}
