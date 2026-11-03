import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LearningErasureService } from './learning-erasure.service';
import { ConversationsService } from '../conversations/conversations.service';
import { dbSuite, makeFixtures, newTestClient } from './testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);
const FK = 'ai_interaction_logs_conversation_id_fkey';
const validated = async () => (await prisma.$queryRaw<Array<{ convalidated: boolean }>>`SELECT convalidated FROM pg_constraint WHERE conname = ${FK}`)[0]?.convalidated;

dbSuite('Historical orphan logs', () => {
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); });

  /**
   * Creates an orphan the way history did, WITHOUT any DDL (so it cannot lock out other suites): a superuser session that skips
   * foreign-key triggers for one transaction. The constraint itself is never touched.
   */
  async function insertOrphan(tenantId: string): Promise<string> {
    const id = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe(
        `INSERT INTO ai_interaction_logs (id, tenant_id, conversation_id, customer_message, ai_response, status, edited_by_agent) VALUES ($1, $2, $3, 'old orphan', 'x', 'SUGGESTED', false)`,
        id, tenantId, randomUUID(),
      );
    });
    return id;
  }

  it('the migration adds the key NOT VALID and never validates it', () => {
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261102130000_ai_interaction_log_conversation_fk/migration.sql'), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(sql).toMatch(/ADD CONSTRAINT "ai_interaction_logs_conversation_id_fkey"[\s\S]*ON DELETE CASCADE[\s\S]*NOT VALID;/);
    expect(sql).not.toMatch(/VALIDATE\s+CONSTRAINT/i);
  });

  it('an existing orphan is tolerated, new rows are still enforced, and VALIDATE (an operator step) fails while the orphan exists', async () => {
    const tenantId = await fx.tenant();
    const orphanId = await insertOrphan(tenantId);
    try {
      expect(await prisma.aiInteractionLog.count({ where: { id: orphanId } })).toBe(1);
      await expect(prisma.aiInteractionLog.create({ data: { tenantId, conversationId: randomUUID(), customerMessage: 'new', aiResponse: 'x' } })).rejects.toMatchObject({ code: 'P2003' });
      await expect(prisma.$executeRawUnsafe(`ALTER TABLE ai_interaction_logs VALIDATE CONSTRAINT ${FK}`)).rejects.toBeDefined();
      expect(await validated()).toBe(false);
    } finally {
      await prisma.aiInteractionLog.deleteMany({ where: { id: orphanId } });
    }
  });

  it('deleting a conversation leaves a historical orphan alone and does not validate the constraint', async () => {
    const tenantId = await fx.tenant();
    const { conversation } = await fx.conversation(tenantId);
    await prisma.aiInteractionLog.create({ data: { tenantId, conversationId: conversation.id, customerMessage: 'real', aiResponse: 'x' } });
    const erasure = new LearningErasureService(prisma as never, { notifyUser: jest.fn() } as never);
    const conversations = new ConversationsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, erasure);
    const orphanId = await insertOrphan(tenantId);
    try {
      await conversations.deleteConversation(tenantId, conversation.id, null);

      expect(await prisma.aiInteractionLog.count({ where: { conversationId: conversation.id } })).toBe(0);
      expect(await prisma.aiInteractionLog.count({ where: { id: orphanId } })).toBe(1);
      expect(await validated()).toBe(false);
    } finally {
      await prisma.aiInteractionLog.deleteMany({ where: { id: orphanId } });
    }
  });
});
