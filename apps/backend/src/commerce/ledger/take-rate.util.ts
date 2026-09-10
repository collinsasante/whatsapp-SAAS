/**
 * Take-rate arithmetic for Managed Commerce. Isolated as pure functions
 * because this is exactly the kind of money math that's easy to get subtly
 * wrong -- in particular, rounding a refund's take-rate clawback
 * independently of the GMV clawback lets them drift apart by a cent over
 * many partial refunds on the same order.
 *
 * computeRefundAdjustment avoids that by always recomputing the take-rate
 * on the *remaining eligible GMV from scratch* (rounded once) and taking
 * the difference from the pre-refund take-rate (also recomputed from
 * scratch). Because each step is "recompute full amount, then diff", a
 * sequence of partial refunds telescopes exactly to the same total
 * clawback as one full refund would produce -- there's no accumulation of
 * independently-rounded deltas to drift.
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeTakeRate(orderTotalMajorUnits: number, takeRatePct: number): number {
  return round2((orderTotalMajorUnits * takeRatePct) / 100);
}

export interface RefundAdjustmentInput {
  orderTotalMajorUnits: number;
  takeRatePct: number;
  /** Sum of all refunds already processed on this order, before this one. */
  alreadyRefundedMajorUnits: number;
  /** The new refund being processed now. */
  refundAmountMajorUnits: number;
}

export interface RefundAdjustmentResult {
  /** Positive amount of previously-earned take-rate being given back. */
  takeRateClawbackMajorUnits: number;
}

const FLOAT_TOLERANCE = 1e-9;

export function computeRefundAdjustment(input: RefundAdjustmentInput): RefundAdjustmentResult {
  const { orderTotalMajorUnits, takeRatePct, alreadyRefundedMajorUnits, refundAmountMajorUnits } = input;

  if (refundAmountMajorUnits <= 0) {
    throw new Error('refundAmountMajorUnits must be positive');
  }

  const remaining = round2(orderTotalMajorUnits - alreadyRefundedMajorUnits);
  if (refundAmountMajorUnits > remaining + FLOAT_TOLERANCE) {
    throw new Error(
      `Refund of ${refundAmountMajorUnits} exceeds the remaining refundable amount of ${remaining} on this order`,
    );
  }

  const eligibleBefore = remaining;
  const eligibleAfter = round2(eligibleBefore - refundAmountMajorUnits);
  const takeRateBefore = computeTakeRate(eligibleBefore, takeRatePct);
  const takeRateAfter = computeTakeRate(eligibleAfter, takeRatePct);

  return { takeRateClawbackMajorUnits: round2(takeRateBefore - takeRateAfter) };
}
