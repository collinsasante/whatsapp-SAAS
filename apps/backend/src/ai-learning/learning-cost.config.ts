/** Platform-controlled learning budgets. Initial safety limits, not provider-guaranteed costs. All amounts in micro-USD. */
export interface LearningCostConfig {
  workspaceMonthlyBudgetMicros: bigint;
  globalMonthlyBudgetMicros: bigint;
  maxReservationMicros: bigint;
}
export const LEARNING_COST_CONFIG = Symbol('LEARNING_COST_CONFIG');

export const DEFAULT_LEARNING_COST_CONFIG: LearningCostConfig = {
  workspaceMonthlyBudgetMicros: 5_000_000n, // USD 5 per workspace per month
  globalMonthlyBudgetMicros: 50_000_000n, // USD 50 across all workspaces per month
  maxReservationMicros: 50_000n, // USD 0.05 per run
};

/** The largest amount (USD) an environment setting may name. Above it the setting is treated as a typo and ignored, so a stray extra digit cannot become the budget. */
export const MAX_CONFIGURABLE_USD = 100_000;

/**
 * "5", "0.05" -> micro-USD. Anything that is not a plain, finite number between 0 and MAX_CONFIGURABLE_USD is rejected (the caller keeps
 * the safe default). Zero is valid and means "spend nothing". Blank, hex, exponent notation, "Infinity" and "NaN" are all rejected.
 */
export function usdToMicros(value: string | undefined): bigint | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > MAX_CONFIGURABLE_USD) return null;
  return BigInt(Math.round(n * 1_000_000));
}

export function loadLearningCostConfig(env: NodeJS.ProcessEnv = process.env): LearningCostConfig {
  return {
    workspaceMonthlyBudgetMicros: usdToMicros(env['AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD']) ?? DEFAULT_LEARNING_COST_CONFIG.workspaceMonthlyBudgetMicros,
    globalMonthlyBudgetMicros: usdToMicros(env['AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD']) ?? DEFAULT_LEARNING_COST_CONFIG.globalMonthlyBudgetMicros,
    maxReservationMicros: usdToMicros(env['AI_LEARNING_MAX_RESERVATION_USD']) ?? DEFAULT_LEARNING_COST_CONFIG.maxReservationMicros,
  };
}
