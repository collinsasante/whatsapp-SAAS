/**
 * The one rule for "does what the gateway says was paid match what we expected". A signed event proves the gateway sent it; it does
 * not prove the amount or currency are the ones this order, credit pack or invoice was created for. Money is only credited, and an
 * order is only marked paid, after this check passes.
 */
export const PAYMENT_AMOUNT_TOLERANCE = 0.01;

/** Thrown before any order, ledger or credit state is changed. */
export class PaymentMismatchError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PaymentMismatchError';
  }
}

export interface ExpectedPayment { amount: number; currency: string }
export interface PaidPayment { amount?: number | null; currency?: string | null }

/**
 * Returns why the payment does not match, or null when it does.
 *  - 'exact': the amount must equal the expected amount (a fixed price: an order or a credit pack). Both underpayment and
 *    overpayment are refused.
 *  - 'at_least': the amount may not be LESS than expected (a gateway subscription plan may charge its own plan price, which
 *    can exceed a discounted invoice). Currency must still match.
 * A missing amount or currency never passes.
 */
export function describePaymentMismatch(expected: ExpectedPayment, paid: PaidPayment, mode: 'exact' | 'at_least' = 'exact'): string | null {
  if (typeof paid.amount !== 'number' || !Number.isFinite(paid.amount)) return 'The payment event carries no valid amount';
  const currency = paid.currency?.trim();
  if (!currency) return 'The payment event carries no currency';
  if (currency.toUpperCase() !== expected.currency.trim().toUpperCase()) {
    return `Currency mismatch: the gateway says ${currency.toUpperCase()}, expected ${expected.currency.trim().toUpperCase()}`;
  }
  const difference = paid.amount - expected.amount;
  if (mode === 'at_least' ? difference < -PAYMENT_AMOUNT_TOLERANCE : Math.abs(difference) > PAYMENT_AMOUNT_TOLERANCE) {
    return `Amount mismatch: the gateway says ${paid.amount}, expected ${expected.amount}`;
  }
  return null;
}
