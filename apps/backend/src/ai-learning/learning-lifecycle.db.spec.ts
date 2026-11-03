/**
 * Training example lifecycle against a real PostgreSQL: what each state does to AI replies and to the stored text, withdrawal, permanent
 * deletion (including the Digital Self style contribution), the holdings summary, and that deleting a conversation removes every example
 * of every state that came from it.
 */
import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, TrainingExampleStatus } from '@prisma/client';
import { AiLearningService } from './ai-learning.service';
import { ApprovedCorrectionsService } from './corrections/approved-corrections.service';
import { DigitalSelfCorrectionsService } from '../digital-self/digital-self-corrections.service';
import { LearningErasureService } from './learning-erasure.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AiLearningController } from './ai-learning.controller';
import { extractFeatures } from '../digital-self/message-features.util';
import { emptyProfile, mergeFeatures, parseProfile } from '../digital-self/profile.util';
import { dbSuite, makeFixtures, newTestClient } from './testing/db-test-env';

const prisma = newTestClient();
const fx = prisma ? makeFixtures(prisma) : (undefined as unknown as ReturnType<typeof makeFixtures>);
const QUESTION = 'Do you deliver to Kumasi on Sundays?';
const ANSWER = 'Yes, we deliver to Kumasi every day including Sundays.';
const SECRET = 'my card is 4111-SECRET';

/** A prisma whose transactions behave normally but whose `aiLearningAuditLog.create` fails inside them (to prove rollback). */
function prismaFailingAudit(real: typeof prisma) {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== '$transaction') return Reflect.get(target, prop, receiver);
      return (fn: (tx: unknown) => unknown, opts?: unknown) => (target.$transaction as (f: unknown, o?: unknown) => unknown)(
        (tx: Prisma.TransactionClient) => fn(new Proxy(tx, { get: (t, p, r) => (p === 'aiLearningAuditLog' ? { create: () => { throw new Error('audit write failed'); } } : Reflect.get(t, p, r)) })), opts);
    },
  });
}

dbSuite('Training example lifecycle (real PostgreSQL)', () => {
  const flagsOn = { isEnabledCached: async () => true };
  const flagsOff = { isEnabledCached: async () => false };
  const corrections = prisma ? new DigitalSelfCorrectionsService(prisma as never, flagsOn as never) : (undefined as unknown as DigitalSelfCorrectionsService);
  const service = prisma ? new AiLearningService(prisma as never, corrections) : (undefined as unknown as AiLearningService);
  const guidance = prisma ? new ApprovedCorrectionsService(prisma as never) : (undefined as unknown as ApprovedCorrectionsService);
  afterEach(() => { delete process.env['AI_CORRECTIONS_DISABLED']; });
  afterAll(async () => { await fx.cleanup(); await prisma.$disconnect(); });
  const ask = (tenantId: string) => guidance.getGuidanceBlock(tenantId, QUESTION);

  async function exampleFor(tenantId: string, status: TrainingExampleStatus = 'APPROVED', conversationId?: string, adminId?: string) {
    const conv = conversationId ? { id: conversationId } : (await fx.conversation(tenantId)).conversation;
    const admin = adminId ? { id: adminId } : await fx.user(tenantId, 'reviewer');
    const execution = await prisma.aiExecution.create({ data: { tenantId, conversationId: conv.id, taskType: 'RESPONDER', provider: 'deepseek', modelKey: 'm', status: 'SUCCESS' } });
    const evaluation = await prisma.aiInteractionEvaluation.create({ data: { tenantId, conversationId: conv.id, aiExecutionId: execution.id, status: 'EVALUATED', evaluatorReasoning: SECRET } });
    const example = await prisma.aiTrainingExample.create({
      data: {
        tenantId, sourceEvaluationId: evaluation.id, sourceConversationId: conv.id, customerInput: QUESTION, actualResponse: SECRET, expectedResponse: ANSWER,
        status, approvedById: status === 'APPROVED' ? admin.id : null, approvedAt: status === 'APPROVED' ? new Date() : null,
      },
    });
    return { conversationId: conv.id, adminId: admin.id, evaluation, example };
  }

  describe('what each state does to AI replies', () => {
    it.each(['DRAFT', 'REVIEW', 'REJECTED', 'ARCHIVED'] as const)('a %s example never influences replies', async (status) => {
      const tenantId = await fx.tenant();
      await exampleFor(tenantId, status);
      expect(await ask(tenantId)).toBe('');
    });

    it('an APPROVED example does, and the listing says so', async () => {
      const tenantId = await fx.tenant();
      const { example } = await exampleFor(tenantId, 'APPROVED');
      expect(await ask(tenantId)).toContain('Kumasi');
      expect((await service.listTrainingExamples(tenantId)).find((e) => e.id === example.id)).toMatchObject({ status: 'APPROVED', influence: 'guidance' });
    });

    it('archiving an approved example stops its influence AT ONCE and clears the approval record, but keeps the text for recovery', async () => {
      const tenantId = await fx.tenant();
      const { example, adminId } = await exampleFor(tenantId, 'APPROVED');
      expect(await ask(tenantId)).not.toBe('');

      const archived = await service.setTrainingExampleStatus(tenantId, example.id, 'ARCHIVED', adminId);

      expect(archived).toMatchObject({ status: 'ARCHIVED', approvedAt: null, approvedById: null, customerInput: QUESTION });
      expect(await ask(tenantId)).toBe('');
      expect((await service.listTrainingExamples(tenantId)).find((e) => e.id === example.id)?.influence).toBe('none');
    });

    it('an archived example can be restored through review and approved again', async () => {
      const tenantId = await fx.tenant();
      const { example, adminId } = await exampleFor(tenantId, 'ARCHIVED');
      await service.setTrainingExampleStatus(tenantId, example.id, 'APPROVED', adminId);
      expect(await ask(tenantId)).toContain('Kumasi');
    });

    it('withdrawing returns an approved example to REVIEW: no influence, approval cleared, audited without text', async () => {
      const tenantId = await fx.tenant();
      const { example, adminId } = await exampleFor(tenantId, 'APPROVED');

      const withdrawn = await service.withdrawTrainingExample(tenantId, example.id, adminId);

      expect(withdrawn).toMatchObject({ status: 'REVIEW', approvedAt: null, approvedById: null });
      expect(await ask(tenantId)).toBe('');
      const audit = await prisma.aiLearningAuditLog.findFirstOrThrow({ where: { tenantId, action: 'training_example.withdrawn' } });
      expect(audit).toMatchObject({ targetId: example.id, previousState: { status: 'APPROVED' }, newState: { status: 'REVIEW' } });
      expect(JSON.stringify(audit)).not.toContain('Kumasi');
    });

    it.each(['DRAFT', 'REVIEW', 'REJECTED', 'ARCHIVED'] as const)('only an approved example can be withdrawn (%s is refused)', async (status) => {
      const tenantId = await fx.tenant();
      const { example, adminId } = await exampleFor(tenantId, status);
      await expect(service.withdrawTrainingExample(tenantId, example.id, adminId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('another workspace cannot withdraw, archive or see it', async () => {
      const a = await fx.tenant();
      const b = await fx.tenant();
      const { example } = await exampleFor(a, 'APPROVED');
      const adminB = await fx.user(b);
      await expect(service.withdrawTrainingExample(b, example.id, adminB.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.setTrainingExampleStatus(b, example.id, 'ARCHIVED', adminB.id)).rejects.toBeInstanceOf(NotFoundException);
      expect((await service.listTrainingExamples(b))).toHaveLength(0);
      expect(await ask(a)).not.toBe('');
    });

    it('the guidance switch and the global kill switch are reflected in the listing', async () => {
      const tenantId = await fx.tenant();
      const { example } = await exampleFor(tenantId, 'APPROVED');
      await prisma.aiLearningSettings.create({ data: { tenantId, approvedGuidanceEnabled: false } });
      expect((await service.listTrainingExamples(tenantId)).find((e) => e.id === example.id)?.influence).toBe('none');
      await prisma.aiLearningSettings.update({ where: { tenantId }, data: { approvedGuidanceEnabled: true } });
      expect((await service.listTrainingExamples(tenantId)).find((e) => e.id === example.id)?.influence).toBe('guidance');
      process.env['AI_CORRECTIONS_DISABLED'] = 'true';
      expect((await service.listTrainingExamples(tenantId)).find((e) => e.id === example.id)?.influence).toBe('none');
    });
  });

  describe('Digital Self style corrections follow the lifecycle', () => {
    const REPLIES = ['Hello! Happy to help 😊 Which size do you need?', 'Sure thing! Let me check that for you, thank you!'];

    async function styleCorrection(tenantId: string) {
      const base = await exampleFor(tenantId, 'APPROVED');
      const agent = await fx.user(tenantId, 'ama');
      const self = await prisma.digitalSelf.create({ data: { tenantId, userId: agent.id, status: 'LEARNING' } });
      let profile = emptyProfile();
      for (const text of REPLIES) {
        const features = extractFeatures(text)!;
        await prisma.digitalSelfLearningEvent.create({ data: { tenantId, digitalSelfId: self.id, messageId: `REPLY:${randomUUID()}`, source: 'REPLY', conversationId: (await fx.conversation(tenantId)).conversation.id, features: features as unknown as Prisma.InputJsonValue, weight: 1 } });
        profile = mergeFeatures(profile, [{ features, weight: 1, correction: false }]);
      }
      const baseline = parseProfile(profile as never);
      const correction = extractFeatures('Please always greet warmly and sign off with thank you')!;
      await prisma.digitalSelfLearningEvent.create({ data: { tenantId, digitalSelfId: self.id, messageId: `correction:${base.example.id}`, source: 'CORRECTION', conversationId: base.conversationId, features: correction as unknown as Prisma.InputJsonValue, weight: 3 } });
      await prisma.aiTrainingExample.update({ where: { id: base.example.id }, data: { digitalSelfId: self.id } });
      profile = mergeFeatures(profile, [{ features: correction, weight: 3, correction: true }]);
      await prisma.digitalSelf.update({ where: { id: self.id }, data: { profile: profile as never, evidenceCount: REPLIES.length } });
      return { ...base, selfId: self.id, baseline };
    }
    const eventCount = (selfId: string) => prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: selfId, source: 'CORRECTION' } });

    it('withdrawing a style correction removes its contribution from the profile', async () => {
      const tenantId = await fx.tenant();
      const w = await styleCorrection(tenantId);
      expect(await eventCount(w.selfId)).toBe(1);

      await service.withdrawTrainingExample(tenantId, w.example.id, w.adminId);

      expect(await eventCount(w.selfId)).toBe(0);
      expect(parseProfile((await prisma.digitalSelf.findUniqueOrThrow({ where: { id: w.selfId } })).profile)).toEqual(w.baseline);
      expect((await prisma.aiTrainingExample.findUniqueOrThrow({ where: { id: w.example.id } })).digitalSelfId).toBeNull();
    });

    it('archiving a style correction removes it too', async () => {
      const tenantId = await fx.tenant();
      const w = await styleCorrection(tenantId);
      await service.setTrainingExampleStatus(tenantId, w.example.id, 'ARCHIVED', w.adminId);
      expect(await eventCount(w.selfId)).toBe(0);
    });
  });

  describe('permanent deletion', () => {
    it('removes the example and every word of its text; the audit row holds the id, the old status and yes/no facts only', async () => {
      const tenantId = await fx.tenant();
      const { example, adminId, evaluation } = await exampleFor(tenantId, 'APPROVED');

      await expect(service.deleteTrainingExample(tenantId, example.id, adminId)).resolves.toEqual({ deleted: true, wasApproved: true, promotedToRegressionCase: false });

      expect(await prisma.aiTrainingExample.count({ where: { id: example.id } })).toBe(0);
      expect(await ask(tenantId)).toBe('');
      expect((await service.listTrainingExamples(tenantId))).toHaveLength(0);
      const audit = await prisma.aiLearningAuditLog.findFirstOrThrow({ where: { tenantId, action: 'training_example.deleted' } });
      expect(audit).toMatchObject({ actorId: adminId, targetType: 'training_example', targetId: example.id, previousState: { status: 'APPROVED', styleContributionRemoved: false, promotedToRegressionCase: false } });
      expect(JSON.stringify(audit)).not.toMatch(/Kumasi|4111/);
      // The evaluation the example came from is a separate record: it is not deleted here.
      expect(await prisma.aiInteractionEvaluation.count({ where: { id: evaluation.id } })).toBe(1);
    });

    it.each(['DRAFT', 'REVIEW', 'REJECTED', 'ARCHIVED'] as const)('deletes a %s example as well', async (status) => {
      const tenantId = await fx.tenant();
      const { example, adminId } = await exampleFor(tenantId, status);
      await expect(service.deleteTrainingExample(tenantId, example.id, adminId)).resolves.toMatchObject({ deleted: true, wasApproved: false });
      expect(await prisma.aiTrainingExample.count({ where: { id: example.id } })).toBe(0);
    });

    it('removes a style correction from the Digital Self and rebuilds it, even with the Digital Self feature flag OFF', async () => {
      const tenantId = await fx.tenant();
      const flagOffService = new AiLearningService(prisma as never, new DigitalSelfCorrectionsService(prisma as never, flagsOff as never));
      const base = await exampleFor(tenantId, 'APPROVED');
      const agent = await fx.user(tenantId, 'kofi');
      const self = await prisma.digitalSelf.create({ data: { tenantId, userId: agent.id, status: 'LEARNING' } });
      const features = extractFeatures('Please always greet warmly and sign off with thank you')!;
      await prisma.digitalSelfLearningEvent.create({ data: { tenantId, digitalSelfId: self.id, messageId: `correction:${base.example.id}`, source: 'CORRECTION', conversationId: base.conversationId, features: features as unknown as Prisma.InputJsonValue, weight: 3 } });
      await prisma.aiTrainingExample.update({ where: { id: base.example.id }, data: { digitalSelfId: self.id } });
      await prisma.digitalSelf.update({ where: { id: self.id }, data: { profile: mergeFeatures(emptyProfile(), [{ features, weight: 3, correction: true }]) as never } });

      await expect(flagOffService.deleteTrainingExample(tenantId, base.example.id, base.adminId)).resolves.toMatchObject({ deleted: true });

      expect(await prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: self.id } })).toBe(0);
      expect(parseProfile((await prisma.digitalSelf.findUniqueOrThrow({ where: { id: self.id } })).profile).correctionSamples).toBe(0);
      expect((await prisma.aiLearningAuditLog.findFirstOrThrow({ where: { tenantId, action: 'training_example.deleted' } })).previousState).toMatchObject({ styleContributionRemoved: true });
    });

    it('says when the example was copied into engineering regression tests, which deleting here cannot undo', async () => {
      const tenantId = await fx.tenant();
      const { example, adminId } = await exampleFor(tenantId, 'APPROVED');
      await prisma.aiTrainingExample.update({ where: { id: example.id }, data: { regressionCaseCreated: true } });
      await expect(service.deleteTrainingExample(tenantId, example.id, adminId)).resolves.toMatchObject({ promotedToRegressionCase: true });
    });

    it('cannot delete another workspace\'s example, an unknown id, or the same example twice', async () => {
      const a = await fx.tenant();
      const b = await fx.tenant();
      const { example, adminId } = await exampleFor(a, 'APPROVED');
      const adminB = await fx.user(b);
      await expect(service.deleteTrainingExample(b, example.id, adminB.id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.deleteTrainingExample(a, randomUUID(), adminId)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.aiTrainingExample.count({ where: { id: example.id } })).toBe(1);
      await service.deleteTrainingExample(a, example.id, adminId);
      await expect(service.deleteTrainingExample(a, example.id, adminId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is all-or-nothing: if the audit write fails, the example and its style contribution are still there', async () => {
      const tenantId = await fx.tenant();
      const base = await exampleFor(tenantId, 'APPROVED');
      const agent = await fx.user(tenantId, 'ama2');
      const self = await prisma.digitalSelf.create({ data: { tenantId, userId: agent.id, status: 'LEARNING' } });
      const features = extractFeatures('Greet warmly please')!;
      await prisma.digitalSelfLearningEvent.create({ data: { tenantId, digitalSelfId: self.id, messageId: `correction:${base.example.id}`, source: 'CORRECTION', conversationId: base.conversationId, features: features as unknown as Prisma.InputJsonValue, weight: 3 } });
      const failing = new AiLearningService(prismaFailingAudit(prisma) as never, corrections);

      await expect(failing.deleteTrainingExample(tenantId, base.example.id, base.adminId)).rejects.toThrow('audit write failed');

      expect(await prisma.aiTrainingExample.count({ where: { id: base.example.id } })).toBe(1);
      expect(await prisma.digitalSelfLearningEvent.count({ where: { digitalSelfId: self.id } })).toBe(1);
    });
  });

  describe('deleting a conversation removes every example from it, whatever its state', () => {
    it('all five states vanish with the conversation; another conversation\'s examples stay', async () => {
      const tenantId = await fx.tenant();
      const { conversation } = await fx.conversation(tenantId);
      const other = await fx.conversation(tenantId);
      const admin = await fx.user(tenantId, 'rev');
      const states = ['DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;
      const mine = await Promise.all(states.map((s) => exampleFor(tenantId, s, conversation.id, admin.id)));
      const kept = await exampleFor(tenantId, 'APPROVED', other.conversation.id, admin.id);
      const erasure = new LearningErasureService(prisma as never, { notifyUser: jest.fn() } as never);
      const conversations = new ConversationsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, erasure);

      await conversations.deleteConversation(tenantId, conversation.id, admin.id);

      expect(await prisma.aiTrainingExample.count({ where: { id: { in: mine.map((m) => m.example.id) } } })).toBe(0);
      expect(await prisma.aiTrainingExample.count({ where: { id: kept.example.id } })).toBe(1);
    });
  });

  describe('holdings: nothing is held silently', () => {
    it('counts the text-bearing records of THIS workspace only, and states that nothing deletes them automatically', async () => {
      const tenantId = await fx.tenant();
      const other = await fx.tenant();
      const { conversationId } = await exampleFor(tenantId, 'APPROVED');
      await exampleFor(tenantId, 'ARCHIVED');
      await prisma.aiInteractionLog.create({ data: { tenantId, conversationId, customerMessage: SECRET, aiResponse: 'x' } });
      await prisma.internalTask.create({ data: { tenantId, department: 'ai_review', title: 't', description: SECRET } });
      await exampleFor(other, 'APPROVED');

      const h = await service.privacyHoldings(tenantId);

      expect(h).toMatchObject({ interactionRecordsWithText: 1, evaluations: 2, evaluationsWithText: 2, reviewTasksWithText: 1, trainingExamples: { total: 2, approved: 1, byStatus: { APPROVED: 1, ARCHIVED: 1 } } });
      expect(h.oldestInteractionRecordAt).toBeInstanceOf(Date);
      expect(h.automaticDeletion).toEqual({ enabled: false, freeTextDays: 90, metricsMonths: 13 });
      expect(JSON.stringify(h)).not.toMatch(/Kumasi|4111/); // counts and dates, never content
    });

    it('an empty workspace holds nothing', async () => {
      const tenantId = await fx.tenant();
      await expect(service.privacyHoldings(tenantId)).resolves.toMatchObject({ interactionRecordsWithText: 0, oldestInteractionRecordAt: null, trainingExamples: { total: 0, approved: 0 } });
    });
  });

  describe('API surface', () => {
    it('exposes withdraw, delete and holdings to workspace admins only (the controller is admin-guarded as a whole)', () => {
      const proto = AiLearningController.prototype as unknown as Record<string, unknown>;
      for (const name of ['withdrawTrainingExample', 'deleteTrainingExample', 'privacyHoldings']) expect(typeof proto[name]).toBe('function');
      expect(Reflect.getMetadata('roles', AiLearningController)).toEqual(['ADMIN']);
    });
  });
});
