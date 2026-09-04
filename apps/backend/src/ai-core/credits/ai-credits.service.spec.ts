import { AiCreditsService } from './ai-credits.service';
import { AiCreditTransactionType, Prisma } from '@prisma/client';

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' });
}

function buildPrismaMock(overrides: Partial<Record<string, unknown>> = {}) {
  const tenant = { aiCredits: 100 };
  const base = {
    tenant: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...tenant })),
      updateMany: jest.fn().mockImplementation(({ data }: { data: { aiCredits: { decrement: number } } }) => {
        tenant.aiCredits -= data.aiCredits.decrement;
        return Promise.resolve({ count: 1 });
      }),
      update: jest.fn().mockImplementation(({ data }: { data: { aiCredits: { increment: number } } }) => {
        tenant.aiCredits += data.aiCredits.increment;
        return Promise.resolve({ ...tenant });
      }),
    },
    aiCreditTransaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'txn-1', ...data })),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(base)),
    ...overrides,
  };
  return base;
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AiCreditsService(prisma as any);
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

  describe('settleForExecution', () => {
    it('decrements the balance and writes a linked AI_USAGE transaction', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const result = await service.settleForExecution('t1', 'exec-1', 15, 'RESPONDER AI usage');

      expect(result.settled).toBe(true);
      expect(prisma.tenant.updateMany).toHaveBeenCalledWith({ where: { id: 't1', aiCredits: { gte: 15 } }, data: { aiCredits: { decrement: 15 } } });
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
      prisma.tenant.updateMany.mockResolvedValue({ count: 0 });
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
      prisma.tenant.updateMany.mockResolvedValue({ count: 0 });
      const service = buildService(prisma);

      const result = await service.chargeFlat('t1', 5, 'legacy AI usage');

      expect(result.settled).toBe(false);
    });
  });

  describe('grant', () => {
    it('increments the balance and writes a PURCHASE transaction linked to the purchase', async () => {
      const prisma = buildPrismaMock();
      const service = buildService(prisma);

      const result = await service.grant('t1', AiCreditTransactionType.PURCHASE, 1000, 'Credit pack purchase', { creditPurchaseId: 'purchase-1' });

      expect(result.settled).toBe(true);
      expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { aiCredits: { increment: 1000 } } });
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
});
