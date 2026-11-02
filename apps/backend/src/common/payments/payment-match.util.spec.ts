import { describePaymentMismatch, PaymentMismatchError } from './payment-match.util';

const expected = { amount: 123.45, currency: 'GHS' };

describe('describePaymentMismatch (exact: orders and credit packs)', () => {
  it('accepts the exact amount and currency', () => {
    expect(describePaymentMismatch(expected, { amount: 123.45, currency: 'GHS' })).toBeNull();
  });

  it('accepts a currency written in another case and a one-pesewa rounding difference', () => {
    expect(describePaymentMismatch(expected, { amount: 123.45, currency: 'ghs' })).toBeNull();
    expect(describePaymentMismatch(expected, { amount: 123.449999, currency: 'GHS' })).toBeNull();
    expect(describePaymentMismatch(expected, { amount: 123.46, currency: 'GHS' })).toBeNull();
  });

  it.each([
    ['an underpayment', 10],
    ['a one-pesewa-too-low payment beyond tolerance', 123.43],
    ['an overpayment', 500],
    ['a payment just over tolerance', 123.47],
  ])('refuses %s', (_label, amount) => {
    expect(describePaymentMismatch(expected, { amount, currency: 'GHS' })).toMatch(/Amount mismatch/);
  });

  it('refuses another currency even when the number matches', () => {
    expect(describePaymentMismatch(expected, { amount: 123.45, currency: 'USD' })).toMatch(/Currency mismatch.*USD.*GHS/);
  });

  it.each([
    ['no amount', { currency: 'GHS' }, /no valid amount/],
    ['a null amount', { amount: null, currency: 'GHS' }, /no valid amount/],
    ['a NaN amount', { amount: NaN, currency: 'GHS' }, /no valid amount/],
    ['no currency', { amount: 123.45 }, /no currency/],
    ['a blank currency', { amount: 123.45, currency: '  ' }, /no currency/],
  ])('refuses an event with %s', (_label, paid, message) => {
    expect(describePaymentMismatch(expected, paid)).toMatch(message);
  });
});

describe('describePaymentMismatch (at_least: gateway subscription plans)', () => {
  it('accepts the expected amount and more, refuses less, and still requires the currency', () => {
    expect(describePaymentMismatch(expected, { amount: 123.45, currency: 'GHS' }, 'at_least')).toBeNull();
    expect(describePaymentMismatch(expected, { amount: 200, currency: 'GHS' }, 'at_least')).toBeNull();
    expect(describePaymentMismatch(expected, { amount: 100, currency: 'GHS' }, 'at_least')).toMatch(/Amount mismatch/);
    expect(describePaymentMismatch(expected, { amount: 200, currency: 'USD' }, 'at_least')).toMatch(/Currency mismatch/);
  });
});

describe('PaymentMismatchError', () => {
  it('carries the reason', () => {
    const error = new PaymentMismatchError('nope');
    expect(error.reason).toBe('nope');
    expect(error.name).toBe('PaymentMismatchError');
    expect(error).toBeInstanceOf(Error);
  });
});
