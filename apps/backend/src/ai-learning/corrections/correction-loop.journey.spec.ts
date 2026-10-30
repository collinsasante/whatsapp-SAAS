import { AiLearningService } from '../ai-learning.service';
import { ApprovedCorrectionsService } from './approved-corrections.service';

/**
 * The whole loop on one shared in-memory store: a reviewer rates an AI reply as bad and says what it should have been, an admin turns
 * that into a training example, approves it, and the next similar customer message for the same business gets it in the prompt block.
 * Real services, fake database. This is automated evidence of the plumbing; it says nothing about how a live model uses the text.
 */
function buildWorld() {
  const examples: Array<Record<string, any>> = [];
  const audit: Array<Record<string, any>> = [];
  const evaluations: Record<string, any> = {
    'eval-1': { id: 'eval-1', tenantId: 'tenant-a', conversationId: 'conv-1', messageId: 'm1', failureCategories: [], status: 'PENDING', aiExecution: { interactionLogId: 'log-1' }, feedback: null },
  };
  const prisma = {
    aiInteractionEvaluation: {
      findFirst: jest.fn(async ({ where }: any) => (evaluations[where.id]?.tenantId === where.tenantId ? evaluations[where.id] : null)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(evaluations[where.id], data)),
    },
    aiEvaluationFeedback: {
      upsert: jest.fn(async ({ where, create }: any) => { evaluations[where.evaluationId].feedback = { ...create }; return create; }),
    },
    aiInteractionLog: { findUnique: jest.fn(async () => ({ customerMessage: 'Do you deliver to Kumasi on weekends?', aiResponse: 'I am not sure, please check our website.' })) },
    aiTrainingExample: {
      findFirst: jest.fn(async ({ where }: any) => examples.find((e) => (!where.id || e.id === where.id) && e.tenantId === where.tenantId && (!where.sourceEvaluationId || e.sourceEvaluationId === where.sourceEvaluationId) && (!where.status?.notIn || !where.status.notIn.includes(e.status))) ?? null),
      create: jest.fn(async ({ data }: any) => { const e = { id: `te-${examples.length + 1}`, approvedAt: null, updatedAt: new Date(), ...data }; examples.push(e); return e; }),
      update: jest.fn(async ({ where, data }: any) => { const e = examples.find((x) => x.id === where.id)!; Object.assign(e, data, { updatedAt: new Date() }); return e; }),
      findMany: jest.fn(async ({ where }: any) => examples.filter((e) => e.tenantId === where.tenantId && e.status === where.status)),
    },
    aiLearningAuditLog: { create: jest.fn(async ({ data }: any) => { audit.push(data); return data; }) },
  };
  return { prisma, examples, audit, learning: new AiLearningService(prisma as never), corrections: new ApprovedCorrectionsService(prisma as never) };
}

const FUTURE = 'can you deliver to Kumasi this weekend?';

describe('correction loop: submission -> approval -> retrieval', () => {
  async function submitAndCreate(w: ReturnType<typeof buildWorld>) {
    await w.learning.submitFeedback('tenant-a', 'eval-1', {
      reviewerId: 'admin-1', rating: 'BAD', notes: 'Should have answered', expectedAction: 'check delivery info first',
      expectedResponse: 'Yes, we deliver to Kumasi Monday to Saturday, usually in 2 days.',
    });
    return w.learning.createTrainingExample('tenant-a', 'eval-1', 'admin-1');
  }

  it('does not influence replies while the example is a draft', async () => {
    const w = buildWorld();
    const ex = await submitAndCreate(w);
    expect(ex.status).toBe('DRAFT');
    expect(await w.corrections.getGuidanceBlock('tenant-a', FUTURE)).toBe('');
  });

  it('reaches a future reply for the same business once approved', async () => {
    const w = buildWorld();
    const ex = await submitAndCreate(w);
    await w.learning.setTrainingExampleStatus('tenant-a', ex.id, 'APPROVED' as never, 'admin-1');

    const block = await w.corrections.getGuidanceBlock('tenant-a', FUTURE);
    expect(block).toContain('REVIEWED GUIDANCE FROM THIS BUSINESS');
    expect(block).toContain('Do you deliver to Kumasi on weekends?');
    expect(block).toContain('check delivery info first');
    expect(block).toContain('Monday to Saturday');
    // The mistaken reply is not fed back.
    expect(block).not.toContain('please check our website');
    expect(w.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['evaluation.feedback_submitted', 'training_example.created', 'training_example.approved']));
  });

  it('is invisible to every other business', async () => {
    const w = buildWorld();
    const ex = await submitAndCreate(w);
    await w.learning.setTrainingExampleStatus('tenant-a', ex.id, 'APPROVED' as never, 'admin-1');
    expect(await w.corrections.getGuidanceBlock('tenant-b', FUTURE)).toBe('');
  });

  it('is not used for an unrelated customer question', async () => {
    const w = buildWorld();
    const ex = await submitAndCreate(w);
    await w.learning.setTrainingExampleStatus('tenant-a', ex.id, 'APPROVED' as never, 'admin-1');
    expect(await w.corrections.getGuidanceBlock('tenant-a', 'how much is the blue denim jacket')).toBe('');
  });

  it.each(['REJECTED', 'ARCHIVED'])('stops influencing replies once an admin sets it to %s', async (status) => {
    const w = buildWorld();
    const ex = await submitAndCreate(w);
    await w.learning.setTrainingExampleStatus('tenant-a', ex.id, 'APPROVED' as never, 'admin-1');
    expect(await w.corrections.getGuidanceBlock('tenant-a', FUTURE)).not.toBe('');
    await w.learning.setTrainingExampleStatus('tenant-a', ex.id, status as never, 'admin-1');
    expect(await w.corrections.getGuidanceBlock('tenant-a', FUTURE)).toBe('');
  });

  it("cannot be approved by another business's admin", async () => {
    const w = buildWorld();
    const ex = await submitAndCreate(w);
    await expect(w.learning.setTrainingExampleStatus('tenant-b', ex.id, 'APPROVED' as never, 'admin-9')).rejects.toThrow('Training example not found');
    expect(await w.corrections.getGuidanceBlock('tenant-a', FUTURE)).toBe('');
  });

  it('refuses a second live example for the same evaluation, but allows a new one after a rejection', async () => {
    const w = buildWorld();
    const first = await submitAndCreate(w);
    await expect(w.learning.createTrainingExample('tenant-a', 'eval-1', 'admin-1')).rejects.toThrow(/already exists/);
    await w.learning.setTrainingExampleStatus('tenant-a', first.id, 'REJECTED' as never, 'admin-1');
    await expect(w.learning.createTrainingExample('tenant-a', 'eval-1', 'admin-1')).resolves.toBeDefined();
  });

  it('refuses to approve an example that has nothing to teach', async () => {
    const w = buildWorld();
    await w.learning.submitFeedback('tenant-a', 'eval-1', { reviewerId: 'admin-1', rating: 'BAD' });
    const ex = await w.learning.createTrainingExample('tenant-a', 'eval-1', 'admin-1');
    await expect(w.learning.setTrainingExampleStatus('tenant-a', ex.id, 'APPROVED' as never, 'admin-1')).rejects.toThrow(/before it can be approved/);
    expect(await w.corrections.getGuidanceBlock('tenant-a', FUTURE)).toBe('');
  });
});
