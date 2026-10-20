import { BillingWebhookController } from './billing-webhook.controller';
import { PaymentGateway, PaymentStatus } from '@whatsapp-platform/shared-types';
import { AiCreditTransactionType } from '@prisma/client';

function buildPayment(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'payment-1', tenantId: 't1', invoiceId: null, gatewayReference: 'VRZ-C-ABC', status: 'PENDING', ...overrides };
}

function buildPurchase(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'purchase-1', tenantId: 't1', credits: 1000, packSlug: 'starter', status: 'PENDING', ...overrides };
}

function buildPrismaMock(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    billingEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({}) },
    payment: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(buildPayment()), update: jest.fn().mockResolvedValue({}) },
    creditPurchase: { findFirst: jest.fn().mockResolvedValue(buildPurchase()), update: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

function buildDeps() {
  return {
    prisma: buildPrismaMock(),
    stripe: { verifyWebhookSignature: jest.fn().mockReturnValue(true), parseWebhookEvent: jest.fn() },
    paystack: {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      parseWebhookEvent: jest.fn().mockResolvedValue({ event: 'charge.success', gatewayReference: 'VRZ-C-ABC', status: 'success' }),
    },
    invoiceService: {},
    subscriptionService: {},
    aiCreditsService: { grant: jest.fn().mockResolvedValue({ settled: true, transaction: { id: 'txn-1' } }) },
    webhookEventService: { recordReceived: jest.fn().mockResolvedValue('event-log-1'), markOutcome: jest.fn().mockResolvedValue(undefined) },
  };
}

function buildController(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new BillingWebhookController(deps.prisma as any, deps.stripe as any, deps.paystack as any, deps.invoiceService as any, deps.subscriptionService as any, deps.aiCreditsService as any, deps.webhookEventService as any);
}

function buildReq() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rawBody: Buffer.from('{}') } as any;
}

describe('BillingWebhookController -- credit purchase grant', () => {
  it('grants credits via AiCreditsService (transactional + idempotent), keyed by creditPurchaseId', async () => {
    const deps = buildDeps();
    const controller = buildController(deps);

    await controller.paystackWebhook(buildReq(), 'sig');

    expect(deps.aiCreditsService.grant).toHaveBeenCalledWith(
      't1', AiCreditTransactionType.PURCHASE, 1000, expect.any(String), { creditPurchaseId: 'purchase-1' },
    );
    expect(deps.prisma.creditPurchase.update).toHaveBeenCalledWith({ where: { id: 'purchase-1' }, data: { status: PaymentStatus.SUCCEEDED } });
  });

  it('does not grant again once the purchase is already SUCCEEDED (webhook-level replay protection)', async () => {
    const deps = buildDeps();
    deps.prisma.creditPurchase.findFirst.mockResolvedValue(buildPurchase({ status: PaymentStatus.SUCCEEDED }));
    const controller = buildController(deps);

    await controller.paystackWebhook(buildReq(), 'sig');

    expect(deps.aiCreditsService.grant).not.toHaveBeenCalled();
  });

  it('skips entirely when the outer BillingEvent dedupe already saw this exact event processed', async () => {
    const deps = buildDeps();
    deps.prisma.billingEvent.findFirst.mockResolvedValue({ id: 'evt-existing' });
    const controller = buildController(deps);

    await controller.paystackWebhook(buildReq(), 'sig');

    expect(deps.aiCreditsService.grant).not.toHaveBeenCalled();
    expect(deps.prisma.payment.update).not.toHaveBeenCalled();
  });

  it('does nothing when the payment reference is unknown', async () => {
    const deps = buildDeps();
    deps.prisma.payment.findFirst.mockResolvedValue(null);
    const controller = buildController(deps);

    await expect(controller.paystackWebhook(buildReq(), 'sig')).resolves.toEqual({ received: true });
    expect(deps.aiCreditsService.grant).not.toHaveBeenCalled();
  });

  it('rejects a payload with an invalid signature', async () => {
    const deps = buildDeps();
    deps.paystack.verifyWebhookSignature.mockReturnValue(false);
    const controller = buildController(deps);

    await expect(controller.paystackWebhook(buildReq(), 'bad-sig')).rejects.toThrow();
  });
});

describe('BillingWebhookController -- retry safety and ordering', () => {
  it('grants credits BEFORE marking the purchase succeeded, so a failed grant is retried instead of skipped', async () => {
    const deps = buildDeps();
    const order: string[] = [];
    deps.aiCreditsService.grant.mockImplementation(async () => { order.push('grant'); return { settled: true, transaction: { id: 't' } }; });
    deps.prisma.creditPurchase.update.mockImplementation(async () => { order.push('mark-succeeded'); return {}; });
    await buildController(deps).paystackWebhook(buildReq(), 'sig');
    expect(order).toEqual(['grant', 'mark-succeeded']);
  });

  it('when the grant fails, the purchase is NOT marked succeeded, so the gateway retry can grant it', async () => {
    const deps = buildDeps();
    deps.aiCreditsService.grant.mockRejectedValueOnce(new Error('db hiccup'));
    await buildController(deps).paystackWebhook(buildReq(), 'sig');
    expect(deps.prisma.creditPurchase.update).not.toHaveBeenCalled();
    // retry
    deps.prisma.billingEvent.findFirst.mockResolvedValue(null); // not yet recorded as processed
    await buildController(deps).paystackWebhook(buildReq(), 'sig');
    expect(deps.aiCreditsService.grant).toHaveBeenCalledTimes(2);
    expect(deps.prisma.creditPurchase.update).toHaveBeenCalledTimes(1);
  });

  it('activates the subscription BEFORE marking the invoice paid, and leaves it unpaid if activation fails', async () => {
    const deps = buildDeps();
    const order: string[] = [];
    const invoice = { id: 'inv1', status: 'PENDING', metadata: { planSlug: 'pro', cycle: 'MONTHLY' } };
    deps.prisma = buildPrismaMock({
      invoice: { findUnique: jest.fn().mockResolvedValue(invoice) },
      plan: { findUnique: jest.fn().mockResolvedValue({ id: 'plan1' }) },
      subscription: { update: jest.fn() },
    });
    deps.prisma.payment.findFirst.mockResolvedValue(buildPayment({ invoiceId: 'inv1', tenantId: 't1' }));
    deps.invoiceService = { markPaid: jest.fn(async () => { order.push('mark-paid'); }) } as never;
    deps.subscriptionService = { activateFromPayment: jest.fn(async () => { order.push('activate'); }) } as never;
    await buildController(deps).paystackWebhook(buildReq(), 'sig');
    expect(order).toEqual(['activate', 'mark-paid']);

    const failing = buildDeps();
    failing.prisma = buildPrismaMock({ invoice: { findUnique: jest.fn().mockResolvedValue(invoice) }, plan: { findUnique: jest.fn().mockResolvedValue({ id: 'plan1' }) }, subscription: { update: jest.fn() } });
    failing.prisma.payment.findFirst.mockResolvedValue(buildPayment({ invoiceId: 'inv1' }));
    failing.invoiceService = { markPaid: jest.fn() } as never;
    failing.subscriptionService = { activateFromPayment: jest.fn().mockRejectedValue(new Error('boom')) } as never;
    await buildController(failing).paystackWebhook(buildReq(), 'sig');
    expect((failing.invoiceService as unknown as { markPaid: jest.Mock }).markPaid).not.toHaveBeenCalled();
  });

  it('a late failure event cannot flip an already succeeded payment to FAILED', async () => {
    const deps = buildDeps();
    deps.paystack.parseWebhookEvent.mockResolvedValue({ event: 'charge.failed', gatewayReference: 'VRZ-C-ABC', status: 'failed' });
    deps.prisma.payment.findFirst.mockResolvedValue(buildPayment({ status: PaymentStatus.SUCCEEDED }));
    await buildController(deps).paystackWebhook(buildReq(), 'sig');
    expect(deps.prisma.payment.update).not.toHaveBeenCalled();
  });

  it('a failure event still fails a pending payment', async () => {
    const deps = buildDeps();
    deps.paystack.parseWebhookEvent.mockResolvedValue({ event: 'charge.failed', gatewayReference: 'VRZ-C-ABC', status: 'failed' });
    deps.prisma.payment.findFirst.mockResolvedValue(buildPayment({ status: PaymentStatus.PENDING }));
    await buildController(deps).paystackWebhook(buildReq(), 'sig');
    expect(deps.prisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PaymentStatus.FAILED }) }));
  });

  it('never trusts the request body for success: nothing is granted when the signature fails', async () => {
    const deps = buildDeps();
    deps.paystack.verifyWebhookSignature.mockReturnValue(false);
    await expect(buildController(deps).paystackWebhook(buildReq(), 'forged')).rejects.toThrow();
    expect(deps.aiCreditsService.grant).not.toHaveBeenCalled();
    expect(deps.prisma.payment.update).not.toHaveBeenCalled();
  });
});
