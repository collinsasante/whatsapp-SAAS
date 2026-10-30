import { estimateCostUsd } from '../models/model-catalog';
import { DEFAULT_MODEL_KEY } from '../models/model-catalog';
import { estimateSimulatedUsage } from './simulation-usage.util';

const row = (over: Partial<Parameters<typeof estimateSimulatedUsage>[0][number]> = {}) => ({ modelKey: DEFAULT_MODEL_KEY, status: 'SUCCESS', inputTokens: 1000, outputTokens: 200, estCostUsd: null as number | null, ...over });

describe('estimateSimulatedUsage: provider usage is what was reported; cost is an estimate; nothing is invented', () => {
  it('sums the provider-reported tokens and prices them from the model catalog', () => {
    const r = estimateSimulatedUsage([row(), row({ inputTokens: 500, outputTokens: 100 })]);
    expect(r).toMatchObject({ calls: 2, succeeded: 2, inputTokens: 1500, outputTokens: 300, callsWithoutTokenCounts: 0, costEstimateComplete: true });
    expect(r.estimatedCostUsd).toBeCloseTo(estimateCostUsd(DEFAULT_MODEL_KEY, 1000, 200) + estimateCostUsd(DEFAULT_MODEL_KEY, 500, 100), 6);
    expect(r.costBasis).toMatch(/not verified/i);
  });

  it('uses a cost the recorder already stored instead of recomputing it', () => {
    const r = estimateSimulatedUsage([row({ estCostUsd: 0.5 })]);
    expect(r.estimatedCostUsd).toBe(0.5);
    expect(r.costEstimateComplete).toBe(true);
  });

  it('a call with no token counts is counted but contributes no tokens, and the cost is marked incomplete (never guessed)', () => {
    const r = estimateSimulatedUsage([row(), row({ inputTokens: null, outputTokens: null, status: 'PROVIDER_ERROR' })]);
    expect(r).toMatchObject({ calls: 2, succeeded: 1, inputTokens: 1000, outputTokens: 200, callsWithoutTokenCounts: 1, costEstimateComplete: false });
    expect(r.estimatedCostUsd).toBeCloseTo(estimateCostUsd(DEFAULT_MODEL_KEY, 1000, 200), 6);
  });

  it('a model the catalog does not know is unpriced, not guessed', () => {
    const r = estimateSimulatedUsage([row({ modelKey: 'some-future-model' })]);
    expect(r.estimatedCostUsd).toBeNull();
    expect(r.costEstimateComplete).toBe(false);
    expect(r.inputTokens).toBe(1000); // the reported tokens are still reported
  });

  it('a stored cost on a call with no tokens is kept (it was recorded, not invented here)', () => {
    const r = estimateSimulatedUsage([row({ inputTokens: null, outputTokens: null, estCostUsd: 0.01 })]);
    expect(r.estimatedCostUsd).toBe(0.01);
    expect(r.callsWithoutTokenCounts).toBe(1);
  });

  it('partial token counts: the known side is summed, the call is flagged, and it is not priced', () => {
    const r = estimateSimulatedUsage([row({ inputTokens: 100, outputTokens: null })]);
    expect(r).toMatchObject({ inputTokens: 100, outputTokens: null, callsWithoutTokenCounts: 1, costEstimateComplete: false, estimatedCostUsd: null });
  });

  it('calls that reported no tokens are UNKNOWN (null), never zero usage, and are not priced', () => {
    const r = estimateSimulatedUsage([row({ status: 'PROVIDER_ERROR', inputTokens: null, outputTokens: null }), row({ status: 'PROVIDER_ERROR', inputTokens: null, outputTokens: null })]);
    expect(r).toMatchObject({ calls: 2, succeeded: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null, callsWithoutTokenCounts: 2, costEstimateComplete: false });
  });

  it('a genuine reported zero stays 0 (reported, not missing)', () => {
    const r = estimateSimulatedUsage([row({ inputTokens: 0, outputTokens: 0 })]);
    expect(r).toMatchObject({ inputTokens: 0, outputTokens: 0, callsWithoutTokenCounts: 0, costEstimateComplete: true, estimatedCostUsd: 0 });
  });

  it('mixed: totals cover only the calls that reported, the figure is flagged as a floor', () => {
    const r = estimateSimulatedUsage([row({ inputTokens: 1000, outputTokens: 200 }), row({ status: 'PROVIDER_ERROR', inputTokens: null, outputTokens: null })]);
    expect(r).toMatchObject({ inputTokens: 1000, outputTokens: 200, callsWithoutTokenCounts: 1, costEstimateComplete: false });
    expect(r.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('labels the cost as an estimate, not a provider charge', () => {
    expect(estimateSimulatedUsage([row({})]).costBasis).toMatch(/not verified/i);
  });

  it('an empty day is all zeros and complete', () => {
    expect(estimateSimulatedUsage([])).toMatchObject({ calls: 0, succeeded: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateComplete: true });
  });

  it('ignores a non-finite stored cost', () => {
    expect(estimateSimulatedUsage([row({ estCostUsd: Number.NaN })]).estimatedCostUsd).toBeCloseTo(estimateCostUsd(DEFAULT_MODEL_KEY, 1000, 200), 6);
  });
});
