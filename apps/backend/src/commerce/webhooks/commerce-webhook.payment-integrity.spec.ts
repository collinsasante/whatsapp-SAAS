import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { PaystackGateway } from '../../billing/gateways/paystack.gateway';
import { CommerceLedgerService } from '../ledger/commerce-ledger.service';
import { CommerceWebhookController } from './commerce-webhook.controller';

/**
 * The Commerce payment webhook end to end through the REAL controller, signature check, parser and ledger service, over a recording
 * fake database. A signed event proves Paystack sent it; it must still match the order's amount and currency, the order must be
 * waiting for payment, and the reference must be the one issued for that order. A refused event changes nothing.
 */
const SECRET = 'sk_test_integrity_suite';
const REFERENCE = 'REF-1';

type Write = { kind: string; data: unknown };

function build(order: Record<string, unknown> | null = {}) {
  const row = order === null ? null : { id: 'order-1', tenantId: 't1', status: 'PENDING_PAYMENT', totalMajorUnits: 123.45, currency: 'GHS', conversationId: null, paystackReference: REFERENCE, ...order };
  const writes: Write[] = [];
  const outcomes: Array<{ status: string; error?: string }> = [];
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockResolvedValue(row) },
    tenantSettings: { findUnique: jest.fn().mockResolvedValue({ takeRatePct: 5 }) },
    platformSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    commerceLedgerEntry: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({
      order: { update: jest.fn().mockImplementation(async ({ data }: { data: unknown }) => { writes.push({ kind: 'order.update', data }); return row; }) },
      commerceLedgerEntry: { create: jest.fn().mockImplementation(async ({ data }: { data: unknown }) => { writes.push({ kind: 'ledger.create', data }); return { id: 'e', ...(data as object) }; }) },
      orderEvent: { create: jest.fn().mockImplementation(async ({ data }: { data: unknown }) => { writes.push({ kind: 'orderEvent.create', data }); return {}; }) },
    })),
  };
  const webhookEvents = {
    recordReceived: jest.fn().mockResolvedValue('log-1'),
    markOutcome: jest.fn().mockImplementation(async (_id: string, status: string, error?: string) => { outcomes.push({ status, error }); }),
  };
  const paystack = new PaystackGateway({ get: () => SECRET } as never);
  const internalTasks = { create: jest.fn().mockResolvedValue({ id: 'task' }) };
  const ledger = new CommerceLedgerService(prisma as never, paystack as never, { markConverted: jest.fn() } as never, webhookEvents as never, internalTasks as never);
  const controller = new CommerceWebhookController(paystack, ledger, webhookEvents as never);
  return { controller, prisma, writes, outcomes, internalTasks };
}

const event = (data: Record<string, unknown>) => JSON.stringify({ event: 'charge.success', data: { reference: REFERENCE, id: 99, ...data } });
const sign = (body: string) => createHmac('sha512', SECRET).update(body).digest('hex');
const deliver = (ctx: ReturnType<typeof build>, body: string, signature = sign(body)) =>
  ctx.controller.paystackWebhook({ rawBody: Buffer.from(body) } as never, signature);

const nothingChanged = (ctx: ReturnType<typeof build>) => {
  expect(ctx.writes).toEqual([]);
  expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  expect(ctx.internalTasks.create).not.toHaveBeenCalled();
};

describe('a valid payment', () => {
  it('marks the order PAID, records GMV and the take rate, once', async () => {
    const ctx = build();
    await expect(deliver(ctx, event({ amount: 12345, currency: 'GHS' }))).resolves.toEqual({ received: true });
    expect(ctx.writes.filter((w) => w.kind === 'order.update')).toEqual([{ kind: 'order.update', data: expect.objectContaining({ status: 'PAID' }) }]);
    expect(ctx.writes.filter((w) => w.kind === 'ledger.create').map((w) => (w.data as { type: string }).type)).toEqual(['GMV', 'TAKE_RATE']);
    expect(ctx.outcomes).toEqual([{ status: 'PROCESSED', error: undefined }]);
  });
});

describe('a signed event that does not match the order is refused before anything changes', () => {
  it.each([
    ['an underpayment (10.00 on 123.45)', { amount: 1000, currency: 'GHS' }, /Amount mismatch/],
    ['a one-pesewa-short payment beyond tolerance', { amount: 12343, currency: 'GHS' }, /Amount mismatch/],
    ['an overpayment (500.00 on 123.45)', { amount: 50000, currency: 'GHS' }, /Amount mismatch/],
    ['the right amount in the wrong currency', { amount: 12345, currency: 'USD' }, /Currency mismatch/],
    ['an event with no amount', { currency: 'GHS' }, /no valid amount/],
    ['an event with no currency', { amount: 12345 }, /no currency/],
  ])('%s', async (_label, data, reason) => {
    const ctx = build();
    await expect(deliver(ctx, event(data as Record<string, unknown>))).resolves.toEqual({ received: true });
    nothingChanged(ctx);
    expect(ctx.outcomes).toEqual([{ status: 'FAILED', error: expect.stringMatching(reason) }]);
  });

  it('a reference that was issued for a different order', async () => {
    const ctx = build({ paystackReference: 'REF-OTHER' });
    await deliver(ctx, event({ amount: 12345, currency: 'GHS', metadata: { orderId: 'order-1' } }));
    nothingChanged(ctx);
    expect(ctx.outcomes[0]).toEqual({ status: 'FAILED', error: expect.stringMatching(/was not issued for order/) });
  });

  it.each(['CANCELLED', 'REFUNDED', 'DRAFT', 'AWAITING_APPROVAL'])('an order that is %s and not waiting for payment', async (status) => {
    const ctx = build({ status });
    await deliver(ctx, event({ amount: 12345, currency: 'GHS' }));
    nothingChanged(ctx);
    expect(ctx.outcomes[0].status).toBe('FAILED');
    expect(ctx.outcomes[0].error).toMatch(new RegExp(`Order is ${status}`));
  });

  it('refusal is answered 200 so the gateway does not resend the same event forever', async () => {
    const ctx = build();
    await expect(deliver(ctx, event({ amount: 1000, currency: 'GHS' }))).resolves.toEqual({ received: true });
  });
});

describe('signatures and unknown orders', () => {
  it.each([
    ['a wrong signature', 'deadbeef'],
    ['an empty signature', ''],
    ['a signature made with another secret', createHmac('sha512', 'other').update('x').digest('hex')],
  ])('%s is rejected and nothing is read or written', async (_label, signature) => {
    const ctx = build();
    await expect(deliver(ctx, event({ amount: 12345, currency: 'GHS' }), signature)).rejects.toBeInstanceOf(BadRequestException);
    nothingChanged(ctx);
    expect(ctx.prisma.order.findUnique).not.toHaveBeenCalled();
    expect(ctx.outcomes).toEqual([]);
  });

  it('a missing signature header is rejected', async () => {
    const ctx = build();
    const body = event({ amount: 12345, currency: 'GHS' });
    await expect(ctx.controller.paystackWebhook({ rawBody: Buffer.from(body) } as never, undefined as never)).rejects.toBeInstanceOf(BadRequestException);
    nothingChanged(ctx);
  });

  it('a body altered after signing is rejected', async () => {
    const ctx = build();
    const body = event({ amount: 12345, currency: 'GHS' });
    await expect(deliver(ctx, body.replace('12345', '99999'), sign(body))).rejects.toBeInstanceOf(BadRequestException);
    nothingChanged(ctx);
  });

  it('a payment for an unknown order changes nothing', async () => {
    const ctx = build(null);
    await expect(deliver(ctx, event({ amount: 12345, currency: 'GHS' }))).resolves.toEqual({ received: true });
    nothingChanged(ctx);
  });

  it('failed-payment events never mark anything paid', async () => {
    const ctx = build();
    await deliver(ctx, JSON.stringify({ event: 'charge.failed', data: { reference: REFERENCE } }));
    nothingChanged(ctx);
  });
});

describe('duplicate and repeated events', () => {
  it('a second delivery for an order that is already PAID adds nothing', async () => {
    const ctx = build({ status: 'PAID' });
    ctx.prisma.commerceLedgerEntry.findFirst.mockResolvedValue({ id: 'existing', type: 'GMV' });
    await deliver(ctx, event({ amount: 12345, currency: 'GHS' }));
    nothingChanged(ctx);
    expect(ctx.outcomes).toEqual([{ status: 'PROCESSED', error: undefined }]);
  });

  it('a different event for an order that is already PAID, even with a wrong amount, is ignored and never double-counts', async () => {
    const ctx = build({ status: 'PAID' });
    await deliver(ctx, event({ id: 12, reference: REFERENCE, amount: 50000, currency: 'GHS' }));
    nothingChanged(ctx);
  });

  it('a refused event followed by the correct one still pays the order exactly once', async () => {
    const ctx = build();
    await deliver(ctx, event({ amount: 1000, currency: 'GHS' }));
    nothingChanged(ctx);
    await deliver(ctx, event({ amount: 12345, currency: 'GHS' }));
    expect(ctx.writes.filter((w) => w.kind === 'ledger.create')).toHaveLength(2); // GMV + TAKE_RATE, once
    expect(ctx.outcomes.map((o) => o.status)).toEqual(['FAILED', 'PROCESSED']);
  });
});

describe('the manual "verify payment" path applies the same rule', () => {
  function service(order: Record<string, unknown>, tx: { status: string; amountMajorUnits: number; currency: string; transactionId: string } | null) {
    const ctx = build(order);
    const paystack = { verifyTransaction: jest.fn().mockResolvedValue(tx) };
    ctx.prisma.order.findFirst.mockResolvedValue({ id: 'order-1', tenantId: 't1', status: 'PENDING_PAYMENT', totalMajorUnits: 123.45, currency: 'GHS', paystackReference: REFERENCE, ...order });
    const svc = new CommerceLedgerService(ctx.prisma as never, paystack as never, { markConverted: jest.fn() } as never, { findOne: jest.fn(), markReprocessed: jest.fn() } as never, { create: jest.fn().mockResolvedValue({ id: 'task' }) } as never);
    return { svc, ctx };
  }

  it('records a payment that matches', async () => {
    const { svc, ctx } = service({}, { status: 'success', amountMajorUnits: 123.45, currency: 'GHS', transactionId: '1' });
    await expect(svc.verifyAndRecordPayment('t1', 'order-1')).resolves.toMatchObject({ verified: true });
    expect(ctx.writes.length).toBeGreaterThan(0);
  });

  it.each([
    ['amount', { status: 'success', amountMajorUnits: 10, currency: 'GHS', transactionId: '1' }, /Amount mismatch/],
    ['currency', { status: 'success', amountMajorUnits: 123.45, currency: 'USD', transactionId: '1' }, /Currency mismatch/],
  ])('refuses a %s mismatch and changes nothing', async (_label, tx, reason) => {
    const { svc, ctx } = service({}, tx);
    await expect(svc.verifyAndRecordPayment('t1', 'order-1')).resolves.toMatchObject({ verified: false, reason: expect.stringMatching(reason) });
    expect(ctx.writes).toEqual([]);
  });

  it("scopes the order to the caller's workspace", async () => {
    const { svc, ctx } = service({}, null);
    await svc.verifyAndRecordPayment('t1', 'order-1');
    expect(ctx.prisma.order.findFirst).toHaveBeenCalledWith({ where: { id: 'order-1', tenantId: 't1' } });
  });
});
