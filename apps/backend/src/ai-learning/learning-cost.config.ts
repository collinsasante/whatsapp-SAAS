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

/** "5", "0.05" -> micro-USD. Anything that is not a finite number >= 0 is rejected (the caller keeps the default). */
export function usdToMicros(value: string | undefined): bigint | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.round(n * 1_000_000));
}

export function loadLearningCostConfig(env: NodeJS.ProcessEnv = process.env): LearningCostConfig {
  return {
    workspaceMonthlyBudgetMicros: usdToMicros(env['AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD']) ?? DEFAULT_LEARNING_COST_CONFIG.workspaceMonthlyBudgetMicros,
    globalMonthlyBudgetMicros: usdToMicros(env['AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD']) ?? DEFAULT_LEARNING_COST_CONFIG.globalMonthlyBudgetMicros,
    maxReservationMicros: usdToMicros(env['AI_LEARNING_MAX_RESERVATION_USD']) ?? DEFAULT_LEARNING_COST_CONFIG.maxReservationMicros,
  };
}
