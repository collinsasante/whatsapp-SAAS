import { AiCreditsService } from './ai-credits.service';
import { AiCreditTransactionType, Prisma } from '@prisma/client';

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' });
}

function buildPrismaMock(overrides: Partial<Record<string, unknown>> = {}) {
  const tenant = { id: 't1', aiCredits: 100 };
  const reservations = new Map<string, Record<string, unknown>>();
  let reservationCounter = 0;
  const base = {
    tenant: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...tenant })),
      updateMany: jest.fn().mockImplementation(({ data }: { data: { aiCredits: { decrement: number } } }) => {
        tenant.aiCredits -= data.aiCredits.decrement;
        return Promise.resolve({ count: 1 });
      }),
      update: jest.fn().mockImplementation(({ data }: { data: { aiCredits: { increment?: number; decrement?: number } } }) => {
        tenant.aiCredits += data.aiCredits.increment ?? 0;
        tenant.aiCredits -= data.aiCredits.decrement ?? 0;
        return Promise.resolve({ ...tenant });
      }),
    },
    aiCreditTransaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'txn-1', ...data })),
    },
    aiCreditReservation: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const id = `reservation-${++reservationCounter}`;
        const reservation = { id, ...data, status: 'RESERVED' };
        reservations.set(id, reservation);
        return Promise.resolve(reservation);
      }),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(reservations.get(where.id) ?? null)),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockImplementation(({ where }: { where: { tenantId: string; status: string } }) => {
        const held = [...reservations.values()]
          .filter((reservation) => reservation.tenantId === where.tenantId && reservation.status === where.status)
          .reduce((total, reservation) => total + Number(reservation.reservedCredits), 0);
        return Promise.resolve({ _sum: { reservedCredits: held || null } });
      }),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const reservation = { ...reservations.get(where.id), ...data };
        reservations.set(where.id, reservation);
        return Promise.resolve(reservation);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const reservation = reservations.get(where.id);
        if (!reservation || reservation.status !== where.status) return Promise.resolve({ count: 0 });
        reservations.set(where.id, { ...reservation, ...data });
        return Promise.resolve({ count: 1 });
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 't1' }]),
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(base)),
    ...overrides,
  };
  return base;
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pricing = {
    getReservationQuote: jest.fn().mockResolvedValue({
      reservedCredits: 50,
      maxCreditsPerAttempt: 25,
      creditsPerUsd: 2000,
      inputPerMTokUsd: 0.14,
      outputPerMTokUsd: 0.28,
    }),
    calculateCreditsForUsage: jest.fn().mockReturnValue(10),
  };
  return new AiCreditsService(prisma as any, pricing as any);
}

describe('AiCreditsService', () => {
  describe('hasSufficientBalance', () => {
    it('is true when balance is positive', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);
      expect(await service.hasSufficientBalance('t1')).toBe(true);
    });

    it('is false when balance is zero', async () => {
      const prisma = buildPrismaMock();
      prisma.tenant.findUnique.mockResolvedValue({ aiCredits: 0 });
      const service = buildService(prisma);
      expect(await service.hasSufficientBalance('t1')).toBe(false);
    });
  });

  describe('provider-call reservations', () => {
    it('reserves before provider use and reduces the available balance', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const reservation = await service.reserveForProviderCall('t1', 'deepseek', 'deepseek-v4-flash', 400, 2);

      expect(reservation.reservedCredits).toBe(50);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(await service.getBalance('t1')).toBe(50);
    });

    it('supports a fixed reservation for the legacy responder estimate', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const reservation = await service.reserveFixedCredits('t1', 2);

      expect(reservation.reservedCredits).toBe(2);
      expect(reservation.maxCreditsPerAttempt).toBe(2);
      expect(prisma.aiCreditReservation.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          reservedCredits: 2,
          pricingCreditsPerUsd: 0,
          pricingInputCostPerMillionUsd: 0,
          pricingOutputCostPerMillionUsd: 0,
        }),
      }));
    });

    it('rejects additional reservations when existing holds consume the balance', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      await service.reserveForProviderCall('t1', 'deepseek', 'deepseek-v4-flash', 400, 2);
      await service.reserveForProviderCall('t1', 'deepseek', 'deepseek-v4-flash', 400, 2);

      await expect(service.reserveForProviderCall('t1', 'deepseek', 'deepseek-v4-flash', 400, 2))
        .rejects.toThrow('Insufficient AI credits');
    });

    it('prevents legacy debits from spending credits held for a provider call', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);
      await service.reserveForProviderCall('t1', 'deepseek', 'deepseek-v4-flash', 400, 2);

      const result = await service.chargeFlat('t1', 60, 'legacy AI usage');

      expect(result.settled).toBe(false);
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('prevents negative admin adjustments from spending reserved credits', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);
      await service.reserveForProviderCall('t1', 'deepseek', 'deepseek-v4-flash', 400, 2);

      const result = await service.grant('t1', AiCreditTransactionType.ADJUSTMENT, -60, 'Adjustment');

      expect(result.settled).toBe(false);
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('settles actual usage plus the maximum charge for an earlier retry attempt', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);
      const reservation = await service.reserveForProviderCall('t1', 'deepseek', 'deepseek-v4-flash', 400, 2);

      const result = await service.settleReservationForUsage(reservation.id, 100, 20, 2, 'RESPONDER AI provider usage');

      expect(result.settled).toBe(true);
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { aiCredits: { decrement: 35 } },
        select: { aiCredits: true },
      });
      expect(await service.getBalance('t1')).toBe(65);
    });
  });

  describe('settleForExecution', () => {
    it('decrements the balance and writes a linked AI_USAGE transaction', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const result = await service.settleForExecution('t1', 'exec-1', 15, 'RESPONDER AI usage');

      expect(result.settled).toBe(true);
      expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { aiCredits: { decrement: 15 } }, select: { aiCredits: true } });
      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: AiCreditTransactionType.AI_USAGE, credits: -15, aiExecutionId: 'exec-1' }),
      }));
    });

    it('writes a $0 ledger row without touching the balance when credits is 0 (failed/blocked call)', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const result = await service.settleForExecution('t1', 'exec-1', 0, 'RESPONDER AI usage');

      expect(result.settled).toBe(true);
      expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ credits: 0 }) }));
    });

    it('is idempotent -- a second settlement for the same aiExecutionId returns the existing row without decrementing again', async () => {
      const prisma = buildPrismaMock();
      const existing = { id: 'txn-existing', aiExecutionId: 'exec-1', credits: -15 };
      prisma.aiCreditTransaction.findUnique.mockResolvedValue(existing);
      const service = buildService(prisma);

      const result = await service.settleForExecution('t1', 'exec-1', 15, 'RESPONDER AI usage');

      expect(result.transaction).toBe(existing);
      expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
      expect(prisma.aiCreditTransaction.create).not.toHaveBeenCalled();
    });

    it('recovers from a concurrent-race unique violation by returning the winning row instead of throwing', async () => {
      const prisma = buildPrismaMock();
      prisma.aiCreditTransaction.create.mockRejectedValueOnce(uniqueViolation());
      const winner = { id: 'txn-winner', aiExecutionId: 'exec-1' };
      prisma.aiCreditTransaction.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      const service = buildService(prisma);

      const result = await service.settleForExecution('t1', 'exec-1', 15, 'RESPONDER AI usage');

      expect(result.settled).toBe(true);
      expect(result.transaction).toBe(winner);
    });

    it('never drives the balance negative -- reports unsettled when balance is insufficient', async () => {
      const prisma = buildPrismaMock();
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', aiCredits: 0 });
      const service = buildService(prisma);

      const result = await service.settleForExecution('t1', 'exec-1', 999, 'RESPONDER AI usage');

      expect(result.settled).toBe(false);
      expect(result.transaction).toBeNull();
      expect(prisma.aiCreditTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('chargeFlat (legacy path)', () => {
    it('decrements and records with an estimated metadata marker', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const result = await service.chargeFlat('t1', 5, 'legacy AI usage');

      expect(result.settled).toBe(true);
      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ credits: -5, metadata: { estimated: true, reason: 'legacy path, no token tracking' } }),
      }));
    });

    it('does not decrement below zero', async () => {
      const prisma = buildPrismaMock();
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', aiCredits: 0 });
      const service = buildService(prisma);

      const result = await service.chargeFlat('t1', 5, 'legacy AI usage');

      expect(result.settled).toBe(false);
    });

    it('deducts and writes the ledger row in one transaction, so a failed ledger insert cannot lose credits', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      await service.chargeFlat('t1', 5, 'legacy AI usage');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      prisma.aiCreditTransaction.create.mockRejectedValueOnce(new Error('db down'));
      await expect(service.chargeFlat('t1', 5, 'legacy AI usage')).rejects.toThrow('db down');
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('grant', () => {
    it('increments the balance and writes a PURCHASE transaction linked to the purchase', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const result = await service.grant('t1', AiCreditTransactionType.PURCHASE, 1000, 'Credit pack purchase', { creditPurchaseId: 'purchase-1' });

      expect(result.settled).toBe(true);
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { aiCredits: { increment: 1000 } },
        select: { aiCredits: true },
      });
      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: AiCreditTransactionType.PURCHASE, credits: 1000, creditPurchaseId: 'purchase-1' }),
      }));
    });

    it('is idempotent -- a duplicate webhook for the same purchase grants exactly once', async () => {
      const prisma = buildPrismaMock();
      const existing = { id: 'txn-existing', creditPurchaseId: 'purchase-1', credits: 1000 };
      prisma.aiCreditTransaction.findUnique.mockResolvedValue(existing);
      const service = buildService(prisma);

      const result = await service.grant('t1', AiCreditTransactionType.PURCHASE, 1000, 'Credit pack purchase', { creditPurchaseId: 'purchase-1' });

      expect(result.transaction).toBe(existing);
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('recovers from a concurrent-race unique violation on the purchase link', async () => {
      const prisma = buildPrismaMock();
      prisma.aiCreditTransaction.create.mockRejectedValueOnce(uniqueViolation());
      const winner = { id: 'txn-winner', creditPurchaseId: 'purchase-1' };
      prisma.aiCreditTransaction.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      const service = buildService(prisma);

      const result = await service.grant('t1', AiCreditTransactionType.PURCHASE, 1000, 'Credit pack purchase', { creditPurchaseId: 'purchase-1' });

      expect(result.transaction).toBe(winner);
    });

    it('supports BONUS grants with no purchase link', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      await service.grant('t1', AiCreditTransactionType.BONUS, 500, 'Welcome bonus');

      expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: AiCreditTransactionType.BONUS, credits: 500, creditPurchaseId: undefined }),
      }));
    });
  });

  describe('getUsageSummary', () => {
    it('summarizes balance, this-month usage/purchases, and lifetime totals', async () => {
      const prisma = buildPrismaMock({
        aiCreditTransaction: {
          findUnique: jest.fn(),
          create: jest.fn(),
          groupBy: jest.fn()
            .mockResolvedValueOnce([
              { type: AiCreditTransactionType.AI_USAGE, _sum: { credits: -30 }, _count: 12 },
              { type: AiCreditTransactionType.PURCHASE, _sum: { credits: 1000 }, _count: 1 },
            ])
            .mockResolvedValueOnce([
              { type: AiCreditTransactionType.AI_USAGE, _sum: { credits: -180 } },
              { type: AiCreditTransactionType.PURCHASE, _sum: { credits: 5000 } },
            ]),
        },
      });
      const service = buildService(prisma);

      const summary = await service.getUsageSummary('t1');

      expect(summary).toEqual({
        currentBalance: 100,
        usedThisMonth: 30,
        purchasedThisMonth: 1000,
        aiRequestsThisMonth: 12,
        totalPurchased: 5000,
        totalUsed: 180,
      });
    });
  });

  describe('adminListTransactions', () => {
    it('is unscoped by default (no tenantId filter) unlike the tenant-facing getTransactions', async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: 'txn-1', tenantId: 't1' }, { id: 'txn-2', tenantId: 't2' }]);
      const count = jest.fn().mockResolvedValue(2);
      const prisma = buildPrismaMock({ aiCreditTransaction: { findUnique: jest.fn(), create: jest.fn(), findMany, count } });
      const service = buildService(prisma);

      const result = await service.adminListTransactions({});

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it('filters by tenantId and type when provided', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = buildPrismaMock({ aiCreditTransaction: { findUnique: jest.fn(), create: jest.fn(), findMany, count } });
      const service = buildService(prisma);

      await service.adminListTransactions({ tenantId: 't1', type: AiCreditTransactionType.AI_USAGE });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { tenantId: 't1', type: AiCreditTransactionType.AI_USAGE },
      }));
    });

    it('clamps limit to 100', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = buildPrismaMock({ aiCreditTransaction: { findUnique: jest.fn(), create: jest.fn(), findMany, count } });
      const service = buildService(prisma);

      await service.adminListTransactions({ limit: 500 });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });
  });
});
