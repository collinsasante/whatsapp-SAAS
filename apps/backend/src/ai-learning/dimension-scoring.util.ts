import { FailureCategory, FailureSeverity } from '@prisma/client';

export type EvaluationDimensionKey =
  | 'contextUnderstanding'
  | 'accuracy'
  | 'naturalness'
  | 'intentHandling'
  | 'commerceReasoning'
  | 'toolSelection'
  | 'toolExecution'
  | 'handoffQuality'
  | 'conversationContinuity'
  | 'responseAppropriateness';

export type DimensionScores = Partial<Record<EvaluationDimensionKey, number>>;

/** Spec section 8: weights sum to 1.0 across the dimensions that are always
 * applicable; commerceReasoning/toolSelection/toolExecution/handoffQuality
 * are conditionally applicable (absent, not zero, when not relevant to a
 * given turn) and are re-normalized in below rather than hardcoded here. */
export const DEFAULT_DIMENSION_WEIGHTS: Record<EvaluationDimensionKey, number> = {
  contextUnderstanding: 0.15,
  accuracy: 0.2,
  naturalness: 0.15,
  intentHandling: 0.1,
  commerceReasoning: 0.1,
  toolSelection: 0.05,
  toolExecution: 0.05,
  handoffQuality: 0.05,
  conversationContinuity: 0.1,
  responseAppropriateness: 0.1,
};

/**
 * Weighted overall score across only the dimensions actually present --
 * spec section 8: "do not simply average blindly, only calculate applicable
 * dimensions." Re-normalizes the applicable weights to sum to 1 so a turn
 * with no Commerce/tool/handoff involvement isn't penalized for those
 * dimensions being inapplicable rather than scored low.
 */
export function computeOverallScore(
  dimensions: DimensionScores,
  weights: Record<EvaluationDimensionKey, number> = DEFAULT_DIMENSION_WEIGHTS,
): number | null {
  const entries = (Object.entries(dimensions) as [EvaluationDimensionKey, number | undefined][])
    .filter((e): e is [EvaluationDimensionKey, number] => typeof e[1] === 'number' && !Number.isNaN(e[1]));
  if (entries.length === 0) return null;

  const totalWeight = entries.reduce((sum, [key]) => sum + (weights[key] ?? 0), 0);
  if (totalWeight <= 0) return null;

  const weightedSum = entries.reduce((sum, [key, score]) => sum + score * (weights[key] ?? 0), 0);
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

export type QualityBand = 'EXCELLENT' | 'GOOD' | 'NEEDS_REVIEW' | 'POOR';

/** Spec section 15: configurable thresholds -- exposed as a param, not
 * hardcoded at every call site, even though only one caller exists today. */
export interface EvaluationThresholds {
  excellent: number;
  good: number;
  needsReview: number;
}

export const DEFAULT_THRESHOLDS: EvaluationThresholds = { excellent: 4.5, good: 3.8, needsReview: 3.0 };

export function classifyQualityBand(score: number | null, thresholds: EvaluationThresholds = DEFAULT_THRESHOLDS): QualityBand {
  if (score === null) return 'POOR';
  if (score >= thresholds.excellent) return 'EXCELLENT';
  if (score >= thresholds.good) return 'GOOD';
  if (score >= thresholds.needsReview) return 'NEEDS_REVIEW';
  return 'POOR';
}

/** Spec section 66: default category -> severity map. A caller may override
 * per-category (e.g. an evaluator-detected false claim always escalates a
 * category to CRITICAL regardless of this table -- see evaluator service). */
const DEFAULT_SEVERITY_BY_CATEGORY: Partial<Record<FailureCategory, FailureSeverity>> = {
  WRONG_PAYMENT_STATE: 'CRITICAL',
  WRONG_ORDER_STATE: 'HIGH',
  WRONG_DELIVERY_STATE: 'HIGH',
  FAILED_HANDOFF: 'HIGH',
  WRONG_PRICE: 'HIGH',
  WRONG_PRODUCT: 'HIGH',
  LOST_CONTEXT: 'HIGH',
  MISUNDERSTOOD_INTENT: 'MEDIUM',
  UNNECESSARY_HANDOFF: 'MEDIUM',
  UNNECESSARY_QUESTION: 'MEDIUM',
  REPEATED_QUESTION: 'MEDIUM',
  ROBOTIC_RESPONSE: 'LOW',
  TOO_VERBOSE: 'LOW',
  TOO_SHORT: 'LOW',
};

/** Highest severity across every detected failure category, defaulting to
 * MEDIUM for a category with no explicit mapping rather than silently
 * dropping severity to undefined. Returns null when there are no failures. */
export function computeSeverity(categories: FailureCategory[]): FailureSeverity | null {
  if (categories.length === 0) return null;
  const order: FailureSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  let worst: FailureSeverity = 'LOW';
  for (const category of categories) {
    const sev = DEFAULT_SEVERITY_BY_CATEGORY[category] ?? 'MEDIUM';
    if (order.indexOf(sev) > order.indexOf(worst)) worst = sev;
  }
  return worst;
}

/** Spec section 15: what forces an automatic evaluation into the review queue,
 * independent of the raw score. Kept as one function so the "what triggers
 * review" policy lives in exactly one place. */
export function needsHumanReview(input: {
  overallScore: number | null;
  severity: FailureSeverity | null;
  falseActionClaim: boolean;
  falseSuccessClaim: boolean;
  unnecessaryHandoff: boolean;
  customerCorrectionDetected: boolean;
  evaluatorConfidence: number | null;
  thresholds?: EvaluationThresholds;
}): boolean {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  if (input.falseActionClaim || input.falseSuccessClaim) return true;
  if (input.severity === 'CRITICAL' || input.severity === 'HIGH') return true;
  if (input.unnecessaryHandoff) return true;
  if (input.customerCorrectionDetected) return true;
  if (input.overallScore !== null && input.overallScore < thresholds.needsReview) return true;
  if (input.evaluatorConfidence !== null && input.evaluatorConfidence < 0.5) return true;
  return false;
}
