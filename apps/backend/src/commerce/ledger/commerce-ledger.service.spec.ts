import { CommerceLedgerService } from './commerce-ledger.service';

function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1', tenantId: 't1', status: 'PENDING_PAYMENT', totalMajorUnits: 100,
    currency: 'GHS', conversationId: null, ...overrides,
  };
}

function buildPrismaMock(overrides: Partial<Record<string, unknown>> = {}) {
  const order = buildOrder();
  return {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
      findFirst: jest.fn().mockResolvedValue(order),
    },
    tenantSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    platformSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    commerceLedgerEntry: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({
      order: { update: jest.fn().mockResolvedValue(order) },
      commerceLedgerEntry: { create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'entry-1', ...data })) },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
    })),
    ...overrides,
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  const paystack = {};
  const leads = { markConverted: jest.fn().mockResolvedValue(undefined) };
  const webhookEventService = { findOne: jest.fn(), markReprocessed: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CommerceLedgerService(prisma as any, paystack as any, leads as any, webhookEventService as any);
}

describe('CommerceLedgerService -- commerce fee default', () => {
  describe('recordPaymentSuccess', () => {
    it('uses the platform default rate when the tenant has never had takeRatePct explicitly set', async () => {
      const prisma = buildPrismaMock();
      prisma.platformSettings.findUnique.mockResolvedValue({ key: 'default_commerce_fee_pct', value: 5 });
      const service = buildService(prisma);

      await service.recordPaymentSuccess('order-1', 'evt-1', 100);

      const txCall = prisma.$transaction.mock.calls[0][0];
      const tx = { commerceLedgerEntry: { create: jest.fn().mockResolvedValue({}) }, order: { update: jest.fn().mockResolvedValue({}) }, orderEvent: { create: jest.fn().mockResolvedValue({}) } };
      await txCall(tx);
      const takeRateCall = tx.commerceLedgerEntry.create.mock.calls.find((c: [{ data: { type: string } }]) => c[0].data.type === 'TAKE_RATE');
      expect(takeRateCall[0].data.amountMajorUnits).toBe(-5); // 5% of 100
      expect(takeRateCall[0].data.data.takeRatePct).toBe(5);
    });

    it('prefers an explicit per-tenant takeRatePct over the platform default', async () => {
      const prisma = buildPrismaMock();
      prisma.tenantSettings.findUnique.mockResolvedValue({ takeRatePct: 10 });
      prisma.platformSettings.findUnique.mockResolvedValue({ key: 'default_commerce_fee_pct', value: 5 });
      const service = buildService(prisma);

      await service.recordPaymentSuccess('order-1', 'evt-1', 100);

      const txCall = prisma.$transaction.mock.calls[0][0];
      const tx = { commerceLedgerEntry: { create: jest.fn().mockResolvedValue({}) }, order: { update: jest.fn().mockResolvedValue({}) }, orderEvent: { create: jest.fn().mockResolvedValue({}) } };
      await txCall(tx);
      const takeRateCall = tx.commerceLedgerEntry.create.mock.calls.find((c: [{ data: { type: string } }]) => c[0].data.type === 'TAKE_RATE');
      expect(takeRateCall[0].data.amountMajorUnits).toBe(-10); // 10% explicit rate, not the 5% default
    });

    it('falls back to 0% when no platform default has ever been configured', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      await service.recordPaymentSuccess('order-1', 'evt-1', 100);

      const txCall = prisma.$transaction.mock.calls[0][0];
      const tx = { commerceLedgerEntry: { create: jest.fn().mockResolvedValue({}) }, order: { update: jest.fn().mockResolvedValue({}) }, orderEvent: { create: jest.fn().mockResolvedValue({}) } };
      await txCall(tx);
      const takeRateCall = tx.commerceLedgerEntry.create.mock.calls.find((c: [{ data: { type: string } }]) => c[0].data.type === 'TAKE_RATE');
      expect(takeRateCall[0].data.amountMajorUnits).toBe(-0);
    });

    it('is idempotent -- a duplicate webhook for an already-PAID order returns the existing entry without re-charging', async () => {
      const prisma = buildPrismaMock();
      prisma.order.findUnique.mockResolvedValue(buildOrder({ status: 'PAID' }));
      const existing = { id: 'entry-existing' };
      prisma.commerceLedgerEntry.findFirst.mockResolvedValue(existing);
      const service = buildService(prisma);

      const result = await service.recordPaymentSuccess('order-1', 'evt-1', 100);

      expect(result).toBe(existing);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});

describe('CommerceLedgerService.reprocessWebhookEvent', () => {
  function buildServiceWithWebhookEvents(prisma: ReturnType<typeof buildPrismaMock>, webhookEventService: { findOne: jest.Mock; markReprocessed: jest.Mock }) {
    const paystack = {};
    const leads = { markConverted: jest.fn().mockResolvedValue(undefined) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new CommerceLedgerService(prisma as any, paystack as any, leads as any, webhookEventService as any);
  }

  it('rejects a webhook event from a non-commerce source', async () => {
    const prisma = buildPrismaMock();
    const webhookEventService = { findOne: jest.fn().mockResolvedValue({ id: 'evt-1', source: 'STRIPE_BILLING' }), markReprocessed: jest.fn() };
    const service = buildServiceWithWebhookEvents(prisma, webhookEventService);

    await expect(service.reprocessWebhookEvent('evt-1')).rejects.toThrow();
    expect(webhookEventService.markReprocessed).not.toHaveBeenCalled();
  });

  it('rejects an unknown webhook event id', async () => {
    const prisma = buildPrismaMock();
    const webhookEventService = { findOne: jest.fn().mockResolvedValue(null), markReprocessed: jest.fn() };
    const service = buildServiceWithWebhookEvents(prisma, webhookEventService);

    await expect(service.reprocessWebhookEvent('missing')).rejects.toThrow();
  });

  it('replays the stored parsed payload through recordPaymentSuccess and marks PROCESSED', async () => {
    const prisma = buildPrismaMock();
    const storedPayload = { event: 'charge.success', status: 'success', gatewayReference: 'ref-1', gatewayPaymentId: 'pay-1', metadata: { orderId: 'order-1' }, amount: 100 };
    const webhookEventService = { findOne: jest.fn().mockResolvedValue({ id: 'evt-1', source: 'PAYSTACK_COMMERCE', payload: storedPayload }), markReprocessed: jest.fn().mockResolvedValue(undefined) };
    const service = buildServiceWithWebhookEvents(prisma, webhookEventService);

    const result = await service.reprocessWebhookEvent('evt-1');

    expect(result).toEqual({ status: 'PROCESSED' });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(webhookEventService.markReprocessed).toHaveBeenCalledWith('evt-1', 'PROCESSED');
  });

  it('marks FAILED (not throwing) if replay itself throws', async () => {
    const prisma = buildPrismaMock();
    prisma.order.findUnique.mockRejectedValue(new Error('db down'));
    const storedPayload = { event: 'charge.success', status: 'success', gatewayReference: 'ref-1', metadata: { orderId: 'order-1' }, amount: 100 };
    const webhookEventService = { findOne: jest.fn().mockResolvedValue({ id: 'evt-1', source: 'PAYSTACK_COMMERCE', payload: storedPayload }), markReprocessed: jest.fn().mockResolvedValue(undefined) };
    const service = buildServiceWithWebhookEvents(prisma, webhookEventService);

    const result = await service.reprocessWebhookEvent('evt-1');

    expect(result).toEqual({ status: 'FAILED' });
    expect(webhookEventService.markReprocessed).toHaveBeenCalledWith('evt-1', 'FAILED', 'db down');
  });
});
