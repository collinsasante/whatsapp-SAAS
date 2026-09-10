import { LeadsService } from './leads.service';

function buildPrismaMock(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lead: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn((args: { create: unknown }) => Promise.resolve({ id: 'lead-1', ...(args.create as object) })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    message: {
      findMany: jest.fn().mockResolvedValue([{ direction: 'INBOUND', content: 'I need 500 labels by Friday, what is the price?' }]),
    },
    tenantSettings: {
      findUnique: jest.fn().mockResolvedValue({ businessName: 'Acme Labels' }),
    },
    conversation: {
      findFirst: jest.fn().mockResolvedValue({ contactId: 'ct1' }),
    },
    ...overrides,
  };
}

function buildOrdersMock() {
  return { findAll: jest.fn().mockResolvedValue([]) };
}

const aiCredits = { hasSufficientBalance: jest.fn().mockResolvedValue(true) };

const QUALIFICATION_JSON = JSON.stringify({
  score: 85,
  status: 'HOT',
  intent: 'Wants 500 printed labels',
  urgencySignal: 'Needs by Friday',
  budgetSignal: null,
  productInterest: 'Label printing',
  recommendedNextAction: 'Send a quote today',
  reasoningSummary: 'High urgency, specific quantity given.',
});

describe('LeadsService', () => {
  describe('scoreConversation', () => {
    it('scores a conversation and upserts a Lead row', async () => {
      const prisma = buildPrismaMock();
      const orders = buildOrdersMock();
      const aiCompletion = { complete: jest.fn().mockResolvedValue({ content: QUALIFICATION_JSON, failed: false }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, aiCompletion as any, aiCredits as any);

      const result = await service.scoreConversation('t1', 'c1', 'ct1');

      expect(aiCompletion.complete).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', taskType: 'LEAD_SCORE', conversationId: 'c1', jsonMode: true }));
      expect(prisma.lead.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { conversationId: 'c1' },
        create: expect.objectContaining({ tenantId: 't1', contactId: 'ct1', conversationId: 'c1', score: 85, status: 'HOT' }),
      }));
      expect(result).toMatchObject({ score: 85, status: 'HOT' });
    });

    it('returns the existing row unchanged when throttled and not forced', async () => {
      const existing = { id: 'lead-1', lastScoredAt: new Date(), score: 40, status: 'ENGAGED' };
      const prisma = buildPrismaMock({ lead: { findUnique: jest.fn().mockResolvedValue(existing), upsert: jest.fn(), updateMany: jest.fn() } });
      const orders = buildOrdersMock();
      const aiCompletion = { complete: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, aiCompletion as any, aiCredits as any);

      const result = await service.scoreConversation('t1', 'c1', 'ct1');

      expect(aiCompletion.complete).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('bypasses the throttle when force:true is passed', async () => {
      const existing = { id: 'lead-1', lastScoredAt: new Date(), score: 40, status: 'ENGAGED' };
      const prisma = buildPrismaMock({ lead: { findUnique: jest.fn().mockResolvedValue(existing), upsert: jest.fn((args: { create: unknown }) => Promise.resolve(args.create)), updateMany: jest.fn() } });
      const orders = buildOrdersMock();
      const aiCompletion = { complete: jest.fn().mockResolvedValue({ content: QUALIFICATION_JSON, failed: false }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, aiCompletion as any, aiCredits as any);

      await service.scoreConversation('t1', 'c1', 'ct1', { force: true });

      expect(aiCompletion.complete).toHaveBeenCalled();
    });

    it('never lets the model set status CONVERTED', async () => {
      const prisma = buildPrismaMock();
      const orders = buildOrdersMock();
      const aiCompletion = { complete: jest.fn().mockResolvedValue({ content: JSON.stringify({ score: 99, status: 'CONVERTED' }), failed: false }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, aiCompletion as any, aiCredits as any);

      await service.scoreConversation('t1', 'c1', 'ct1');

      expect(prisma.lead.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: 'NEW' }) }));
    });

    it('falls back to the existing row on a provider failure', async () => {
      const existing = { id: 'lead-1', lastScoredAt: null, score: 10, status: 'NEW' };
      const prisma = buildPrismaMock({ lead: { findUnique: jest.fn().mockResolvedValue(existing), upsert: jest.fn(), updateMany: jest.fn() } });
      const orders = buildOrdersMock();
      const aiCompletion = { complete: jest.fn().mockResolvedValue({ content: '', failed: true }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, aiCompletion as any, aiCredits as any);

      const result = await service.scoreConversation('t1', 'c1', 'ct1');

      expect(prisma.lead.upsert).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('falls back to the existing row on unparseable JSON', async () => {
      const existing = { id: 'lead-1', lastScoredAt: null, score: 10, status: 'NEW' };
      const prisma = buildPrismaMock({ lead: { findUnique: jest.fn().mockResolvedValue(existing), upsert: jest.fn(), updateMany: jest.fn() } });
      const orders = buildOrdersMock();
      const aiCompletion = { complete: jest.fn().mockResolvedValue({ content: 'not json', failed: false }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, aiCompletion as any, aiCredits as any);

      const result = await service.scoreConversation('t1', 'c1', 'ct1');

      expect(result).toBe(existing);
    });

    it('skips the AI call entirely when the tenant has insufficient credits', async () => {
      const existing = { id: 'lead-1', lastScoredAt: null, score: 10, status: 'NEW' };
      const prisma = buildPrismaMock({ lead: { findUnique: jest.fn().mockResolvedValue(existing), upsert: jest.fn(), updateMany: jest.fn() } });
      const orders = buildOrdersMock();
      const aiCompletion = { complete: jest.fn() };
      const noCredits = { hasSufficientBalance: jest.fn().mockResolvedValue(false) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, aiCompletion as any, noCredits as any);

      const result = await service.scoreConversation('t1', 'c1', 'ct1');

      expect(aiCompletion.complete).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });
  });

  describe('markConverted', () => {
    it('updates the lead status to CONVERTED', async () => {
      const prisma = buildPrismaMock();
      const orders = buildOrdersMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, {} as any, aiCredits as any);

      await service.markConverted('t1', 'c1');

      expect(prisma.lead.updateMany).toHaveBeenCalledWith({ where: { tenantId: 't1', conversationId: 'c1' }, data: { status: 'CONVERTED' } });
    });
  });

  describe('rescore', () => {
    it('looks up the conversation contactId and force-scores it', async () => {
      const prisma = buildPrismaMock();
      const orders = buildOrdersMock();
      const aiCompletion = { complete: jest.fn().mockResolvedValue({ content: QUALIFICATION_JSON, failed: false }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, aiCompletion as any, aiCredits as any);

      await service.rescore('t1', 'c1');

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', tenantId: 't1' }, select: { contactId: true } });
      expect(aiCompletion.complete).toHaveBeenCalled();
    });

    it('returns null when the conversation does not belong to the tenant', async () => {
      const prisma = buildPrismaMock({ conversation: { findFirst: jest.fn().mockResolvedValue(null) } });
      const orders = buildOrdersMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new LeadsService(prisma as any, orders as any, {} as any, aiCredits as any);

      const result = await service.rescore('t1', 'c1');

      expect(result).toBeNull();
    });
  });
});
