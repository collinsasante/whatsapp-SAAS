/**
 * Real PostgreSQL (+ Redis for the queue case). Deleting a conversation or a contact must erase what AI Learning derived from it, in the
 * same transaction, and must be all-or-nothing. See LearningErasureService for the contract these tests pin down.
 */
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ERASURE_TX_OPTIONS, LearningErasureService } from './learning-erasure.service';
import { evalJobId } from './ai-learning-trigger.service';
import { extractFeatures } from '../digital-self/message-features.util';
import { emptyProfile, mergeFeatures, parseProfile } from '../digital-self/profile.util';
import { lockConversationAndReadExclusion, lockDigitalSelf } from '../digital-self/evidence.util';
import { dbSuite, learningRedisUrl, makeFixtures, newTestClient } from './testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SECRET_TEXT = 'my card number is 4111-SECRET and my address is 12 Palm Street';

dbSuite('Learning erasure on conversation and contact deletion (real PostgreSQL)', () => {
  const notifications = { notifyUser: jest.fn().mockResolvedValue({}) };
  const erasure = prisma ? new LearningErasureService(prisma as never, notifications as never) : (undefined as unknown as LearningErasureService);
  const contacts = prisma ? new ContactsService(prisma as never, erasure) : (undefined as unknown as ContactsService);
  const conversations = prisma ? new ConversationsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, erasure) : (undefined as unknown as ConversationsService);
  beforeEach(() => notifications.notifyUser.mockClear());
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); });

  /** One conversation with a message, an executed AI turn, its interaction log, an evaluation with feedback, and review artefacts. */
  async function world(tenantId: string, opts: { approvedExample?: boolean; digitalSelfId?: string } = {}) {
    const { contact, conversation } = await fx.conversation(tenantId);
    const admin = await fx.user(tenantId, 'reviewer');
    await prisma.message.create({ data: { tenantId, conversationId: conversation.id, contactId: contact.id, direction: 'INBOUND', type: 'TEXT', content: SECRET_TEXT } as never });
    const execution = await prisma.aiExecution.create({
      data: {
        tenantId, conversationId: conversation.id, taskType: 'RESPONDER', provider: 'deepseek', modelKey: 'deepseek-v4-flash', status: 'SUCCESS',
        inputTokens: 321, outputTokens: 45, estCostUsd: new Prisma.Decimal('0.000123'), latencyMs: 777,
        toolTrace: [{ name: 'lookup', input: { q: SECRET_TEXT }, result: 'ok' }], errorMessage: `failed for ${SECRET_TEXT}`,
      },
    });
    const log = await prisma.aiInteractionLog.create({ data: { tenantId, conversationId: conversation.id, customerMessage: SECRET_TEXT, aiResponse: 'noted' } });
    await prisma.aiExecution.update({ where: { id: execution.id }, data: { interactionLogId: log.id } });
    const evaluation = await prisma.aiInteractionEvaluation.create({ data: { tenantId, conversationId: conversation.id, aiExecutionId: execution.id, status: 'EVALUATED', evaluatorReasoning: SECRET_TEXT } });
    await prisma.aiEvaluationFeedback.create({ data: { evaluationId: evaluation.id, tenantId, reviewerId: admin.id, rating: 'BAD', notes: SECRET_TEXT } });
    await prisma.aiCustomerCorrection.create({ data: { tenantId, evaluationId: evaluation.id, correctionMessageId: randomUUID(), reviewerNotes: SECRET_TEXT } });
    const example = await prisma.aiTrainingExample.create({
      data: {
        tenantId, sourceEvaluationId: evaluation.id, sourceConversationId: conversation.id, customerInput: SECRET_TEXT, actualResponse: 'x', expectedResponse: 'y',
        status: opts.approvedExample ? 'APPROVED' : 'DRAFT', approvedAt: opts.approvedExample ? new Date() : null, digitalSelfId: opts.digitalSelfId ?? null,
      },
    });
    const task = await prisma.internalTask.create({ data: { tenantId, department: 'ai_review', title: `AI response needs review -- evaluation ${evaluation.id}`, description: SECRET_TEXT, conversationId: conversation.id } });
    return { contact, conversation, admin, execution, log, evaluation, example, task };
  }
  async function opted() {
    const tenantId = await fx.tenant();
    return tenantId;
  }

  describe('deleting a conversation', () => {
    it('erases the log, evaluation, feedback, corrections, examples and review task, scrubs the execution text, and keeps the usage metrics', async () => {
      const tenantId = await opted();
      const w = await world(tenantId, { approvedExample: true });

      await conversations.deleteConversation(tenantId, w.conversation.id, w.admin.id);

      expect(await prisma.conversation.count({ where: { id: w.conversation.id } })).toBe(0);
      expect(await prisma.message.count({ where: { conversationId: w.conversation.id } })).toBe(0);
      expect(await prisma.aiInteractionLog.count({ where: { conversationId: w.conversation.id } })).toBe(0);
      expect(await prisma.aiInteractionEvaluation.count({ where: { id: w.evaluation.id } })).toBe(0);
      expect(await prisma.aiEvaluationFeedback.count({ where: { evaluationId: w.evaluation.id } })).toBe(0);
      expect(await prisma.aiCustomerCorrection.count({ where: { evaluationId: w.evaluation.id } })).toBe(0);
      expect(await prisma.aiTrainingExample.count({ where: { id: w.example.id } })).toBe(0);
      expect(await prisma.internalTask.count({ where: { id: w.task.id } })).toBe(0);

      const execution = await prisma.aiExecution.findUniqueOrThrow({ where: { id: w.execution.id } });
      expect(execution.toolTrace).toBeNull();
      expect(execution.errorMessage).toBeNull();
      expect(execution.interactionLogId).toBeNull();
      expect(execution).toMatchObject({ inputTokens: 321, outputTokens: 45, latencyMs: 777, status: 'SUCCESS', modelKey: 'deepseek-v4-flash' });
      expect(execution.estCostUsd?.toString()).toBe('0.000123');
    });

    it('records identifiers and counts ONLY in the audit row, never text, and tells the admins about the removed approved example', async () => {
      const tenantId = await opted();
      const w = await world(tenantId, { approvedExample: true });
      const admin = await prisma.user.update({ where: { id: w.admin.id }, data: { role: 'ADMIN' } });

      await conversations.deleteConversation(tenantId, w.conversation.id, admin.id);

      const audit = await prisma.aiLearningAuditLog.findFirstOrThrow({ where: { tenantId, action: 'learning.erased_for_deletion' } });
      expect(audit).toMatchObject({ actorId: admin.id, targetType: 'conversation', targetId: w.conversation.id });
      expect(audit.previousState).toMatchObject({ interactionLogs: 1, evaluations: 1, trainingExamples: 1, approvedExamples: 1, approvedExampleIds: [w.example.id], reviewTasks: 1, executionsScrubbed: 1 });
      expect(JSON.stringify(audit)).not.toContain('4111');
      expect(JSON.stringify(audit)).not.toContain('Palm Street');
      expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
      expect(notifications.notifyUser).toHaveBeenCalledWith(admin.id, tenantId, expect.objectContaining({ title: 'Approved AI training examples were removed', body: expect.stringContaining('1 approved AI training example') }));
      expect(JSON.stringify(notifications.notifyUser.mock.calls)).not.toContain('4111');
    });

    it('sends no notification when no approved example was removed', async () => {
      const tenantId = await opted();
      const w = await world(tenantId, { approvedExample: false });
      await conversations.deleteConversation(tenantId, w.conversation.id, w.admin.id);
      expect(notifications.notifyUser).not.toHaveBeenCalled();
      expect(await prisma.aiLearningAuditLog.count({ where: { tenantId, action: 'learning.erased_for_deletion' } })).toBe(1);
    });

    it('writes no audit row for a conversation that had no learning data', async () => {
      const tenantId = await opted();
      const { conversation } = await fx.conversation(tenantId);
      await conversations.deleteConversation(tenantId, conversation.id, null);
      expect(await prisma.aiLearningAuditLog.count({ where: { tenantId } })).toBe(0);
    });

    it('does not touch the learning cost ledger, AI credits, or another conversation / workspace', async () => {
      const tenantId = await opted();
      const other = await opted();
      const mine = await world(tenantId);
      const sibling = await world(tenantId, { approvedExample: true });
      const theirs = await world(other, { approvedExample: true });
      await prisma.tenant.update({ where: { id: tenantId }, data: { aiCredits: 500 } });
      await prisma.aiLearningUsage.create({ data: { tenantId, aiExecutionId: mine.execution.id, runNo: 1, state: 'COMPLETED', reservedMicros: 1200n, actualMicros: 540n, estimatedInputTokens: 2000, priceTableVersion: 'x', leaseExpiresAt: new Date() } });

      await conversations.deleteConversation(tenantId, mine.conversation.id, mine.admin.id);

      expect(await prisma.aiLearningUsage.count({ where: { aiExecutionId: mine.execution.id } })).toBe(1);
      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).aiCredits).toBe(500);
      for (const kept of [sibling, theirs]) {
        expect(await prisma.aiInteractionLog.count({ where: { conversationId: kept.conversation.id } })).toBe(1);
        expect(await prisma.aiTrainingExample.count({ where: { id: kept.example.id } })).toBe(1);
        expect(await prisma.internalTask.count({ where: { id: kept.task.id } })).toBe(1);
        expect((await prisma.aiExecution.findUniqueOrThrow({ where: { id: kept.execution.id } })).toolTrace).not.toBeNull();
      }
    });

    it('refuses a conversation of another workspace and changes nothing', async () => {
      const a = await opted();
      const b = await opted();
      const wb = await world(b);

      await expect(conversations.deleteConversation(a, wb.conversation.id, null)).rejects.toBeInstanceOf(NotFoundException);
      await expect(prisma.$transaction((tx) => erasure.eraseInTransaction(tx, a, [wb.conversation.id], null, { type: 'conversation', id: wb.conversation.id }), ERASURE_TX_OPTIONS))
        .rejects.toThrow(/do not belong to this workspace/);

      expect(await prisma.conversation.count({ where: { id: wb.conversation.id } })).toBe(1);
      expect(await prisma.aiInteractionLog.count({ where: { conversationId: wb.conversation.id } })).toBe(1);
    });
  });

  describe('all-or-nothing', () => {
    /**
     * Makes deleting THIS tenant's rows from `table` fail, and nobody else's: the trigger only raises for the tenant under test, so
     * other suites running against the same database at the same moment are unaffected.
     */
    async function withBrokenErasure<T>(table: string, tenantId: string, body: () => Promise<T>): Promise<T> {
      const fn = `fail_${table}_${randomUUID().slice(0, 6)}`.replace(/-/g, '_');
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN IF OLD.tenant_id = '${tenantId}' THEN RAISE EXCEPTION 'erasure blocked for test'; END IF; RETURN OLD; END $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      try { return await body(); } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER ${fn} ON ${table}`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);
      }
    }

    it.each(['ai_interaction_logs', 'ai_training_examples', 'ai_interaction_evaluations', 'internal_tasks'])('a failure erasing %s aborts the whole conversation deletion', async (table) => {
      const tenantId = await opted();
      const w = await world(tenantId, { approvedExample: true });

      await withBrokenErasure(table, tenantId, async () => {
        await expect(conversations.deleteConversation(tenantId, w.conversation.id, null)).rejects.toThrow();
      });

      expect(await prisma.conversation.count({ where: { id: w.conversation.id } })).toBe(1);
      expect(await prisma.message.count({ where: { conversationId: w.conversation.id } })).toBe(1);
      expect(await prisma.aiInteractionLog.count({ where: { conversationId: w.conversation.id } })).toBe(1);
      expect(await prisma.aiTrainingExample.count({ where: { id: w.example.id } })).toBe(1);
      expect(await prisma.internalTask.count({ where: { id: w.task.id } })).toBe(1);
      const execution = await prisma.aiExecution.findUniqueOrThrow({ where: { id: w.execution.id } });
      expect(execution.toolTrace).not.toBeNull(); // the scrub was rolled back too
      expect(await prisma.aiLearningAuditLog.count({ where: { tenantId, action: 'learning.erased_for_deletion' } })).toBe(0);
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it('a failure deleting the messages after the erasure ran rolls the erasure back too', async () => {
      const tenantId = await opted();
      const w = await world(tenantId, { approvedExample: true });

      await withBrokenErasure('messages', tenantId, async () => {
        await expect(conversations.deleteConversation(tenantId, w.conversation.id, null)).rejects.toThrow();
      });

      expect(await prisma.aiInteractionLog.count({ where: { conversationId: w.conversation.id } })).toBe(1);
      expect(await prisma.aiTrainingExample.count({ where: { id: w.example.id } })).toBe(1);
      expect((await prisma.aiExecution.findUniqueOrThrow({ where: { id: w.execution.id } })).toolTrace).not.toBeNull();
    });

    it('a failure aborts a CONTACT deletion as a whole: contact, every conversation and all learning data remain', async () => {
      const tenantId = await opted();
      const w = await world(tenantId, { approvedExample: true });

      await withBrokenErasure('ai_training_examples', tenantId, async () => {
        await expect(contacts.remove(tenantId, w.contact.id)).rejects.toThrow();
      });

      expect(await prisma.contact.count({ where: { id: w.contact.id } })).toBe(1);
      expect(await prisma.conversation.count({ where: { id: w.conversation.id } })).toBe(1);
      expect(await prisma.aiInteractionLog.count({ where: { conversationId: w.conversation.id } })).toBe(1);
    });
  });

  describe('deleting a contact', () => {
    it('erases the learning data of every one of its conversations, and nothing of its neighbours', async () => {
      const tenantId = await opted();
      const first = await world(tenantId, { approvedExample: true });
      const secondConversation = await prisma.conversation.create({ data: { tenantId, contactId: first.contact.id } });
      const secondLog = await prisma.aiInteractionLog.create({ data: { tenantId, conversationId: secondConversation.id, customerMessage: SECRET_TEXT, aiResponse: 'ok' } });
      const neighbour = await world(tenantId, { approvedExample: true });

      await contacts.remove(tenantId, first.contact.id, first.admin.id);

      expect(await prisma.contact.count({ where: { id: first.contact.id } })).toBe(0);
      expect(await prisma.conversation.count({ where: { contactId: first.contact.id } })).toBe(0);
      expect(await prisma.aiInteractionLog.count({ where: { id: { in: [first.log.id, secondLog.id] } } })).toBe(0);
      expect(await prisma.aiTrainingExample.count({ where: { id: first.example.id } })).toBe(0);
      expect(await prisma.aiInteractionLog.count({ where: { id: neighbour.log.id } })).toBe(1);
      expect(await prisma.aiTrainingExample.count({ where: { id: neighbour.example.id } })).toBe(1);
      const audit = await prisma.aiLearningAuditLog.findFirstOrThrow({ where: { tenantId, action: 'learning.erased_for_deletion' } });
      expect(audit).toMatchObject({ targetType: 'contact', targetId: first.contact.id });
      expect(audit.previousState).toMatchObject({ conversations: 2, interactionLogs: 2 });
    });

    it('cannot delete another workspace\'s contact', async () => {
      const a = await opted();
      const b = await opted();
      const wb = await world(b);
      await expect(contacts.remove(a, wb.contact.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.contact.count({ where: { id: wb.contact.id } })).toBe(1);
    });
  });

  describe('Digital Self profiles are rebuilt from the evidence that remains', () => {
    const REPLIES_A = ['Hello! Happy to help 😊 Which size do you need?', 'Sure thing! Let me check that for you, thank you!'];
    const REPLIES_B = ['hi, yes we deliver to Kumasi', 'ok noted, will send it tomorrow', 'thanks, anything else?'];

    async function seedSelf(tenantId: string, convA: string, convB: string) {
      const agent = await fx.user(tenantId, 'ama');
      const self = await prisma.digitalSelf.create({ data: { tenantId, userId: agent.id, status: 'LEARNING' } });
      let profile = emptyProfile();
      const add = async (conversationId: string, text: string, source = 'REPLY', weight = 1) => {
        const features = extractFeatures(text)!;
        await prisma.digitalSelfLearningEvent.create({ data: { tenantId, digitalSelfId: self.id, messageId: `${source}:${randomUUID()}`, source, conversationId, features: features as unknown as Prisma.InputJsonValue, weight } });
        profile = mergeFeatures(profile, [{ features, weight, correction: source === 'CORRECTION' }]);
      };
      for (const t of REPLIES_A) await add(convA, t);
      for (const t of REPLIES_B) await add(convB, t);
      await prisma.digitalSelf.update({ where: { id: self.id }, data: { profile: { ...profile, overrides: { greeting: 'Hello' } } as never, evidenceCount: 5, lastLearnedAt: new Date() } });
      return { self, agent, add };
    }

    it('removes the deleted conversation\'s evidence and rebuilds the profile to equal one built from the remaining evidence only (overrides kept)', async () => {
      const tenantId = await opted();
      const a = await fx.conversation(tenantId);
      const b = await fx.conversation(tenantId);
      const { self } = await seedSelf(tenantId, a.conversation.id, b.conversation.id);

      await conversations.deleteConversation(tenantId, a.conversation.id, null);

      const rebuilt = await prisma.digitalSelf.findUniqueOrThrow({ where: { id: self.id } });
      expect(await prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: self.id } })).toBe(REPLIES_B.length);
      expect(rebuilt.evidenceCount).toBe(REPLIES_B.length);
      const expected = mergeFeatures({ ...emptyProfile(), overrides: { greeting: 'Hello' } } as ReturnType<typeof emptyProfile>, REPLIES_B.map((t) => ({ features: extractFeatures(t)!, weight: 1, correction: false })));
      expect(parseProfile(rebuilt.profile)).toEqual(parseProfile(expected));
      expect(rebuilt.profileVersion).toBeGreaterThan(1);
    });

    it('removes an applied style correction from the profile when its conversation is deleted, with its approved example', async () => {
      const tenantId = await opted();
      const a = await fx.conversation(tenantId);
      const b = await fx.conversation(tenantId);
      const { self, add } = await seedSelf(tenantId, a.conversation.id, b.conversation.id);
      const w = await world(tenantId, { approvedExample: true, digitalSelfId: self.id });
      await add(w.conversation.id, 'Please always greet warmly and sign off with thank you', 'CORRECTION', 3);
      await prisma.digitalSelf.update({ where: { id: self.id }, data: { evidenceCount: 5 } });

      await contacts.remove(tenantId, w.contact.id, null);

      expect(await prisma.aiTrainingExample.count({ where: { id: w.example.id } })).toBe(0);
      expect(await prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: self.id, source: 'CORRECTION' } })).toBe(0);
      expect(await prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: self.id } })).toBe(REPLIES_A.length + REPLIES_B.length);
      expect((await prisma.digitalSelf.findUniqueOrThrow({ where: { id: self.id } })).evidenceCount).toBe(REPLIES_A.length + REPLIES_B.length);
    });

    it('RACE: a learner holding the conversation lock finishes first; the erasure then removes its evidence and the profile matches', async () => {
      const tenantId = await opted();
      const a = await fx.conversation(tenantId);
      const b = await fx.conversation(tenantId);
      const { self } = await seedSelf(tenantId, a.conversation.id, b.conversation.id);
      const features = extractFeatures('One more reply, written while the conversation is being deleted!')!;
      let learnerDone = false;

      const learner = prisma.$transaction(async (tx) => {
        expect(await lockConversationAndReadExclusion(tx, tenantId, a.conversation.id)).toBe(false); // shared lock, as the real learner takes
        await lockDigitalSelf(tx, self.id);
        await tx.digitalSelfLearningEvent.create({ data: { tenantId, digitalSelfId: self.id, messageId: `REPLY:${randomUUID()}`, source: 'REPLY', conversationId: a.conversation.id, features: features as unknown as Prisma.InputJsonValue, weight: 1 } });
        await tx.digitalSelf.update({ where: { id: self.id }, data: { evidenceCount: { increment: 1 } } });
        await sleep(600);
        learnerDone = true;
      });
      await sleep(150);
      const deletion = conversations.deleteConversation(tenantId, a.conversation.id, null).then(() => { expect(learnerDone).toBe(true); });
      await Promise.all([learner, deletion]);

      expect(await prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: self.id, conversationId: a.conversation.id } })).toBe(0);
      expect((await prisma.digitalSelf.findUniqueOrThrow({ where: { id: self.id } })).evidenceCount).toBe(REPLIES_B.length);
    });
  });

  describe('pending evaluation jobs', () => {
    const queueDescribe = learningRedisUrl ? describe : describe.skip;
    queueDescribe('with a real Redis queue', () => {
      it('drops the queued evaluation job of a deleted conversation after the commit', async () => {
        const redis = new URL(learningRedisUrl!);
        const queue = new Queue(`erasure-${randomUUID().slice(0, 8)}`, { connection: { host: redis.hostname, port: Number(redis.port), maxRetriesPerRequest: null }, prefix: `ailtest-${randomUUID().slice(0, 6)}` });
        try {
          const tenantId = await opted();
          const w = await world(tenantId);
          const queued = new LearningErasureService(prisma as never, notifications as never, queue as never);
          const conversationsWithQueue = new ConversationsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, queued);
          await queue.add('evaluate', { tenantId, aiExecutionId: w.execution.id }, { jobId: evalJobId(w.execution.id), delay: 60_000 });
          const other = await queue.add('evaluate', { tenantId, aiExecutionId: 'someone-else' }, { jobId: evalJobId('someone-else'), delay: 60_000 });

          await conversationsWithQueue.deleteConversation(tenantId, w.conversation.id, null);

          expect(await queue.getJob(evalJobId(w.execution.id))).toBeUndefined();
          expect((await queue.getJob(other.id!))?.id).toBe(other.id);
        } finally {
          await queue.obliterate({ force: true }).catch(() => undefined);
          await queue.close();
        }
      });
    });
  });
});
