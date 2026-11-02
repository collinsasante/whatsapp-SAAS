import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { AiCreditTransactionType } from '@prisma/client';
import { BillingWebhookController } from './billing-webhook.controller';
import { PaystackGateway } from './gateways/paystack.gateway';

/**
 * The billing webhook (AI credit packs and subscription invoices) through the REAL controller and Paystack signature check, over a
 * recording fake database. Credits are granted, and a subscription activated, only for a payment whose amount and currency match what
 * the purchase or invoice was created for.
 */
const SECRET = 'sk_test_billing_integrity';
const REFERENCE = 'VRZ-C-1';

type Overrides = { payment?: Record<string, unknown> | null; purchase?: Record<string, unknown> | null; invoice?: Record<string, unknown> | null };

function build(over: Overrides = {}) {
  const payment = over.payment === null ? null : { id: 'pay-1', tenantId: 't1', invoiceId: null, gatewayReference: REFERENCE, status: 'PENDING', amount: 10, currency: 'GHS', metadata: null, ...over.payment };
  const purchase = over.purchase === null ? null : { id: 'purchase-1', tenantId: 't1', credits: 1000, packSlug: 'starter-1000', status: 'PENDING', ...over.purchase };
  const outcomes: Array<{ status: string; error?: string }> = [];
  const prisma = {
    billingEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({}) },
    payment: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(payment), update: jest.fn().mockResolvedValue({}) },
    creditPurchase: { findFirst: jest.fn().mockResolvedValue(purchase), update: jest.fn().mockResolvedValue({}) },
    invoice: { findUnique: jest.fn().mockResolvedValue(over.invoice === undefined ? null : over.invoice) },
    plan: { findUnique: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
    subscription: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({}) },
  };
  const credits = { grant: jest.fn().mockResolvedValue({ settled: true, transaction: { id: 'txn' } }) };
  const subscriptions = { activateFromPayment: jest.fn().mockResolvedValue({}) };
  const invoices = { markPaid: jest.fn().mockResolvedValue({}) };
  const events = {
    recordReceived: jest.fn().mockResolvedValue('log-1'),
    markOutcome: jest.fn().mockImplementation(async (_id: string, status: string, error?: string) => { outcomes.push({ status, error }); }),
  };
  const paystack = new PaystackGateway({ get: () => SECRET } as never);
  const controller = new BillingWebhookController(prisma as never, {} as never, paystack, invoices as never, subscriptions as never, credits as never, events as never);
  return { controller, prisma, credits, subscriptions, invoices, outcomes };
}

const charge = (data: Record<string, unknown>) => JSON.stringify({ event: 'charge.success', data: { reference: REFERENCE, ...data } });
const deliver = (ctx: ReturnType<typeof build>, body: string, signature = createHmac('sha512', SECRET).update(body).digest('hex')) =>
  ctx.controller.paystackWebhook({ rawBody: Buffer.from(body) } as never, signature);

const nothingChanged = (ctx: ReturnType<typeof build>) => {
  expect(ctx.credits.grant).not.toHaveBeenCalled();
  expect(ctx.subscriptions.activateFromPayment).not.toHaveBeenCalled();
  expect(ctx.invoices.markPaid).not.toHaveBeenCalled();
  expect(ctx.prisma.payment.update).not.toHaveBeenCalled();
  expect(ctx.prisma.creditPurchase.update).not.toHaveBeenCalled();
  expect(ctx.prisma.billingEvent.create).not.toHaveBeenCalled();
};

describe('AI credit purchase webhook', () => {
  it('grants the pack once for the exact amount and currency', async () => {
    const ctx = build();
    await deliver(ctx, charge({ amount: 1000, currency: 'GHS' }));
    expect(ctx.credits.grant).toHaveBeenCalledWith('t1', AiCreditTransactionType.PURCHASE, 1000, expect.any(String), { creditPurchaseId: 'purchase-1' });
    expect(ctx.prisma.creditPurchase.update).toHaveBeenCalledWith({ where: { id: 'purchase-1' }, data: { status: 'SUCCEEDED' } });
    expect(ctx.outcomes).toEqual([{ status: 'PROCESSED', error: undefined }]);
  });

  it.each([
    ['an underpayment (GH₵1 for a GH₵10 pack)', { amount: 100, currency: 'GHS' }, /Amount mismatch/],
    ['an overpayment', { amount: 5000, currency: 'GHS' }, /Amount mismatch/],
    ['the right number in another currency', { amount: 1000, currency: 'USD' }, /Currency mismatch/],
    ['an event with no amount', { currency: 'GHS' }, /no valid amount/],
    ['an event with no currency', { amount: 1000 }, /no currency/],
  ])('refuses %s: no credits, no state change', async (_label, data, reason) => {
    const ctx = build();
    await expect(deliver(ctx, charge(data as Record<string, unknown>))).resolves.toEqual({ received: true });
    nothingChanged(ctx);
    expect(ctx.outcomes).toEqual([{ status: 'FAILED', error: expect.stringMatching(reason) }]);
  });

  it.each([
    ['a forged signature', 'deadbeef'],
    ['an empty signature', ''],
  ])('%s grants nothing', async (_label, signature) => {
    const ctx = build();
    await expect(deliver(ctx, charge({ amount: 1000, currency: 'GHS' }), signature)).rejects.toBeInstanceOf(BadRequestException);
    nothingChanged(ctx);
    expect(ctx.prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('a payment for an unknown reference grants nothing', async () => {
    const ctx = build({ payment: null });
    await deliver(ctx, charge({ amount: 1000, currency: 'GHS' }));
    nothingChanged(ctx);
  });

  it('a replay after the purchase succeeded grants nothing more', async () => {
    const ctx = build({ purchase: { status: 'SUCCEEDED' } });
    await deliver(ctx, charge({ amount: 1000, currency: 'GHS' }));
    expect(ctx.credits.grant).not.toHaveBeenCalled();
  });
});

describe('subscription invoice webhook (existing subscribers)', () => {
  const invoice = { id: 'inv-1', status: 'OPEN', metadata: { planId: 'plan-1', cycle: 'MONTHLY' } };

  it('activates when the plan charge covers the invoice, including when the gateway plan price is higher than a discounted invoice', async () => {
    for (const amount of [60000, 80000]) {
      const ctx = build({ payment: { invoiceId: 'inv-1', amount: 600, currency: 'GHS' }, invoice });
      await deliver(ctx, charge({ amount, currency: 'GHS' }));
      expect(ctx.subscriptions.activateFromPayment).toHaveBeenCalledTimes(1);
      expect(ctx.invoices.markPaid).toHaveBeenCalledWith('inv-1');
    }
  });

  it.each([
    ['less than the invoice', { amount: 30000, currency: 'GHS' }, /Amount mismatch/],
    ['in another currency', { amount: 60000, currency: 'USD' }, /Currency mismatch/],
  ])('refuses a payment %s and activates nothing', async (_label, data, reason) => {
    const ctx = build({ payment: { invoiceId: 'inv-1', amount: 600, currency: 'GHS' }, invoice });
    await deliver(ctx, charge(data));
    nothingChanged(ctx);
    expect(ctx.outcomes[0]).toEqual({ status: 'FAILED', error: expect.stringMatching(reason) });
  });
});
