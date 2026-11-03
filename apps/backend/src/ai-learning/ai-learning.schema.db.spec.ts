import { randomUUID } from 'crypto';
import { dbSuite, makeFixtures, newTestClient } from './testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);

const log = (tenantId: string, conversationId: string) => ({
  tenantId, conversationId, customerMessage: 'where is my order', aiResponse: 'let me check',
});
const usage = (tenantId: string, aiExecutionId: string, runNo: number, state: 'RESERVED' | 'EXPIRED' | 'COMPLETED' = 'RESERVED') => ({
  tenantId, aiExecutionId, runNo, state, reservedMicros: BigInt(50_000), estimatedInputTokens: 100, priceTableVersion: 'test', leaseExpiresAt: new Date(Date.now() + 60_000),
});

dbSuite('AI Learning schema against a real PostgreSQL', () => {
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); }, 120_000); // many fixture tenants cascade-delete here: allow for a slow disposable database

  describe('AiLearningSettings defaults', () => {
    it('a new row is opted OUT, not paused, with approved guidance ON and no budget override', async () => {
      const tenantId = await fx.tenant();
      const row = await prisma.aiLearningSettings.create({ data: { tenantId } });
      expect(row).toMatchObject({ learningEnabled: false, learningPaused: false, approvedGuidanceEnabled: true, monthlyBudgetMicros: null, enabledAt: null });
    });

    it('allows one settings row per workspace', async () => {
      const tenantId = await fx.tenant();
      await prisma.aiLearningSettings.create({ data: { tenantId } });
      await expect(prisma.aiLearningSettings.create({ data: { tenantId } })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('is removed with its workspace', async () => {
      const tenantId = await fx.tenant();
      await prisma.aiLearningSettings.create({ data: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
      expect(await prisma.aiLearningSettings.count({ where: { tenantId } })).toBe(0);
    });
  });

  describe('AiInteractionLog -> Conversation foreign key (ON DELETE CASCADE, NOT VALID)', () => {
    it('is recorded as NOT VALID with ON DELETE CASCADE', async () => {
      const rows = await prisma.$queryRaw<Array<{ convalidated: boolean; confdeltype: string }>>`
        SELECT convalidated, confdeltype::text FROM pg_constraint WHERE conname = 'ai_interaction_logs_conversation_id_fkey'`;
      expect(rows).toEqual([{ convalidated: false, confdeltype: 'c' }]);
    });

    it('rejects a log for a conversation that does not exist', async () => {
      const tenantId = await fx.tenant();
      await expect(prisma.aiInteractionLog.create({ data: log(tenantId, randomUUID()) })).rejects.toMatchObject({ code: 'P2003' });
    });

    it('deleting a conversation deletes its logs and no other conversation\'s', async () => {
      const tenantId = await fx.tenant();
      const a = await fx.conversation(tenantId);
      const b = await fx.conversation(tenantId);
      await prisma.aiInteractionLog.create({ data: log(tenantId, a.conversation.id) });
      await prisma.aiInteractionLog.create({ data: log(tenantId, b.conversation.id) });

      await prisma.conversation.delete({ where: { id: a.conversation.id } });

      expect(await prisma.aiInteractionLog.count({ where: { conversationId: a.conversation.id } })).toBe(0);
      expect(await prisma.aiInteractionLog.count({ where: { conversationId: b.conversation.id } })).toBe(1);
    });

    it('RACE, deletion first: a log insert issued while the deleter holds the conversation lock waits, then fails and leaves nothing', async () => {
      const tenantId = await fx.tenant();
      const { conversation } = await fx.conversation(tenantId);
      let insertOutcome: 'pending' | 'rejected' | 'created' = 'pending';
      let insertCode: unknown;

      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversation.id} FOR UPDATE`;
        void prisma.aiInteractionLog.create({ data: log(tenantId, conversation.id) })
          .then(() => { insertOutcome = 'created'; }, (err: { code?: string }) => { insertOutcome = 'rejected'; insertCode = err.code; });
        await new Promise((r) => setTimeout(r, 400));
        expect(insertOutcome).toBe('pending'); // blocked on the conversation row, not racing past the delete
        await tx.conversation.delete({ where: { id: conversation.id } });
      });
      await new Promise((r) => setTimeout(r, 300));

      expect(insertOutcome).toBe('rejected');
      expect(insertCode).toBe('P2003');
      expect(await prisma.aiInteractionLog.count({ where: { conversationId: conversation.id } })).toBe(0);
    });

    it('RACE, insert first: a delete that starts after the log is committed cascades it away', async () => {
      const tenantId = await fx.tenant();
      const { conversation } = await fx.conversation(tenantId);
      await prisma.aiInteractionLog.create({ data: log(tenantId, conversation.id) });

      await prisma.conversation.delete({ where: { id: conversation.id } });

      expect(await prisma.aiInteractionLog.count({ where: { conversationId: conversation.id } })).toBe(0);
    });
  });

  describe('AiLearningUsage ledger constraints', () => {
    it('allows one RESERVED row per execution, but a new one once the old is EXPIRED (takeover order)', async () => {
      const tenantId = await fx.tenant();
      const execution = randomUUID();
      const first = await prisma.aiLearningUsage.create({ data: usage(tenantId, execution, 1) });

      await expect(prisma.aiLearningUsage.create({ data: usage(tenantId, execution, 2) })).rejects.toMatchObject({ code: 'P2002' });

      await prisma.aiLearningUsage.update({ where: { id: first.id }, data: { state: 'EXPIRED' } });
      await expect(prisma.aiLearningUsage.create({ data: usage(tenantId, execution, 2) })).resolves.toMatchObject({ runNo: 2, state: 'RESERVED' });
    });

    it('does not let two executions block each other', async () => {
      const tenantId = await fx.tenant();
      await prisma.aiLearningUsage.create({ data: usage(tenantId, randomUUID(), 1) });
      await expect(prisma.aiLearningUsage.create({ data: usage(tenantId, randomUUID(), 1) })).resolves.toBeDefined();
    });

    it('rejects a duplicate (execution, runNo) whatever the state', async () => {
      const tenantId = await fx.tenant();
      const execution = randomUUID();
      await prisma.aiLearningUsage.create({ data: usage(tenantId, execution, 1, 'COMPLETED') });
      await expect(prisma.aiLearningUsage.create({ data: usage(tenantId, execution, 1, 'EXPIRED') })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rejects negative amounts and a run number below 1', async () => {
      const tenantId = await fx.tenant();
      await expect(prisma.aiLearningUsage.create({ data: { ...usage(tenantId, randomUUID(), 1), reservedMicros: BigInt(-1) } })).rejects.toBeDefined();
      await expect(prisma.aiLearningUsage.create({ data: usage(tenantId, randomUUID(), 0) })).rejects.toBeDefined();
    });

    it('survives deletion of the execution it paid for (no foreign key to AiExecution)', async () => {
      const tenantId = await fx.tenant();
      const execution = randomUUID();
      await prisma.aiLearningUsage.create({ data: usage(tenantId, execution, 1, 'COMPLETED') });
      expect(await prisma.aiLearningUsage.count({ where: { aiExecutionId: execution } })).toBe(1);
    });
  });
});
