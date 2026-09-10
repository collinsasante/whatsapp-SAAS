import { computeTakeRate, computeRefundAdjustment } from './take-rate.util';

describe('computeTakeRate', () => {
  it('computes a whole-number percentage', () => {
    expect(computeTakeRate(1000, 5)).toBe(50);
  });

  it('computes a fractional percentage', () => {
    expect(computeTakeRate(1000, 2.5)).toBe(25);
  });

  it('rounds to 2 decimal places', () => {
    expect(computeTakeRate(33.33, 5)).toBe(1.67); // 1.6665 -> 1.67
  });

  it('returns 0 for a 0 total', () => {
    expect(computeTakeRate(0, 5)).toBe(0);
  });
});

describe('computeRefundAdjustment', () => {
  it('claws back the full take-rate on a full refund', () => {
    const { takeRateClawbackMajorUnits } = computeRefundAdjustment({
      orderTotalMajorUnits: 1000,
      takeRatePct: 5,
      alreadyRefundedMajorUnits: 0,
      refundAmountMajorUnits: 1000,
    });
    expect(takeRateClawbackMajorUnits).toBe(50);
  });

  it('claws back a proportional amount on a 50% partial refund', () => {
    const { takeRateClawbackMajorUnits } = computeRefundAdjustment({
      orderTotalMajorUnits: 1000,
      takeRatePct: 5,
      alreadyRefundedMajorUnits: 0,
      refundAmountMajorUnits: 400,
    });
    // Order = 1000, take-rate initially 50. Refund 400 -> eligible GMV drops
    // to 600 -> take-rate should now be 30. Clawback = 50 - 30 = 20.
    expect(takeRateClawbackMajorUnits).toBe(20);
  });

  it('sequential partial refunds sum to exactly the same clawback as one full refund (no rounding drift)', () => {
    const orderTotalMajorUnits = 1000;
    const takeRatePct = 5;

    // Refund in three uneven chunks that don't divide cleanly.
    const first = computeRefundAdjustment({
      orderTotalMajorUnits, takeRatePct, alreadyRefundedMajorUnits: 0, refundAmountMajorUnits: 333.33,
    });
    const second = computeRefundAdjustment({
      orderTotalMajorUnits, takeRatePct, alreadyRefundedMajorUnits: 333.33, refundAmountMajorUnits: 333.33,
    });
    const third = computeRefundAdjustment({
      orderTotalMajorUnits, takeRatePct, alreadyRefundedMajorUnits: 666.66, refundAmountMajorUnits: 333.34,
    });

    const sequentialTotal = round2(
      first.takeRateClawbackMajorUnits + second.takeRateClawbackMajorUnits + third.takeRateClawbackMajorUnits,
    );

    const fullRefund = computeRefundAdjustment({
      orderTotalMajorUnits, takeRatePct, alreadyRefundedMajorUnits: 0, refundAmountMajorUnits: 1000,
    });

    expect(sequentialTotal).toBe(fullRefund.takeRateClawbackMajorUnits);
    expect(sequentialTotal).toBe(50);
  });

  it('rejects a refund exceeding the remaining refundable amount', () => {
    expect(() => computeRefundAdjustment({
      orderTotalMajorUnits: 1000,
      takeRatePct: 5,
      alreadyRefundedMajorUnits: 600,
      refundAmountMajorUnits: 500, // only 400 remains
    })).toThrow(/exceeds the remaining refundable amount/);
  });

  it('rejects a refund exceeding the order total on a fresh order', () => {
    expect(() => computeRefundAdjustment({
      orderTotalMajorUnits: 1000,
      takeRatePct: 5,
      alreadyRefundedMajorUnits: 0,
      refundAmountMajorUnits: 1000.01,
    })).toThrow(/exceeds the remaining refundable amount/);
  });

  it('rejects a non-positive refund amount', () => {
    expect(() => computeRefundAdjustment({
      orderTotalMajorUnits: 1000,
      takeRatePct: 5,
      alreadyRefundedMajorUnits: 0,
      refundAmountMajorUnits: 0,
    })).toThrow(/must be positive/);
  });

  it('allows refunding exactly the remaining amount (float-tolerance boundary)', () => {
    const { takeRateClawbackMajorUnits } = computeRefundAdjustment({
      orderTotalMajorUnits: 1000,
      takeRatePct: 5,
      alreadyRefundedMajorUnits: 700,
      refundAmountMajorUnits: 300,
    });
    expect(takeRateClawbackMajorUnits).toBe(15);
  });
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
