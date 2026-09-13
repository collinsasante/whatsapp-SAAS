import { AiInteractionEvalProcessor } from './ai-interaction-eval.processor';
import { ResolvedInteractionContext } from './interaction-context.resolver';

function buildContext(): ResolvedInteractionContext {
  return {
    conversationId: 'conv-1', contactId: 'contact-1', customerMessage: 'hi', aiResponse: 'hello',
    priorContext: [], latestOrderStatus: null, handoffTaskExists: false, humanOwned: false, conversationStatus: 'OPEN',
  };
}

function buildJob(overrides: Partial<{ attemptsMade: number; attempts: number }> = {}) {
  return {
    data: { aiExecutionId: 'exec-1', tenantId: 'tenant-1' },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 3 },
  } as never;
}

function build() {
  const prisma = {
    aiInteractionEvaluation: { upsert: jest.fn().mockResolvedValue({ id: 'eval-1' }) },
    aiLearningAuditLog: { create: jest.fn().mockResolvedValue({}) },
    internalTask: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const resolver = { resolve: jest.fn() };
  const evaluator = { evaluate: jest.fn() };
  const internalTasks = { create: jest.fn().mockResolvedValue({}) };
  const processor = new AiInteractionEvalProcessor(prisma as never, resolver as never, evaluator as never, internalTasks as never);
  return { processor, prisma, resolver, evaluator, internalTasks };
}

describe('AiInteractionEvalProcessor', () => {
  it('throws (for BullMQ to retry) when the interaction context is not yet resolvable', async () => {
    const { processor, resolver } = build();
    resolver.resolve.mockResolvedValue(null);

    await expect(processor.process(buildJob())).rejects.toThrow();
  });

  it('upserts the evaluation keyed by aiExecutionId -- idempotent on redelivery', async () => {
    const { processor, prisma, resolver, evaluator } = build();
    resolver.resolve.mockResolvedValue(buildContext());
    evaluator.evaluate.mockResolvedValue({
      dimensions: { accuracy: 5 }, overallScore: 5, failureCategories: [], severity: null,
      reasoning: 'ok', confidence: 0.9, needsHumanReview: false, falseActionClaim: false,
      falseSuccessClaim: false, unnecessaryHandoff: false, customerCorrectionDetected: false,
    });

    await processor.process(buildJob());
    await processor.process(buildJob());

    expect(prisma.aiInteractionEvaluation.upsert).toHaveBeenCalledTimes(2);
    for (const call of prisma.aiInteractionEvaluation.upsert.mock.calls) {
      expect(call[0].where).toEqual({ aiExecutionId: 'exec-1' });
    }
  });

  it('persists a FAILED evaluation only on the last attempt, not on every retry', async () => {
    const { processor, prisma, resolver, evaluator } = build();
    resolver.resolve.mockResolvedValue(buildContext());
    evaluator.evaluate.mockResolvedValue(null);

    // Not the last attempt -- should throw to let BullMQ retry, not persist FAILED yet.
    await expect(processor.process(buildJob({ attemptsMade: 0, attempts: 3 }))).rejects.toThrow();
    expect(prisma.aiInteractionEvaluation.upsert).not.toHaveBeenCalled();

    // Last attempt -- should persist a FAILED row instead of throwing forever.
    await processor.process(buildJob({ attemptsMade: 2, attempts: 3 }));
    expect(prisma.aiInteractionEvaluation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { aiExecutionId: 'exec-1' } }),
    );
  });

  it('creates a real InternalTask for a CRITICAL-severity evaluation', async () => {
    const { processor, internalTasks, resolver, evaluator } = build();
    resolver.resolve.mockResolvedValue(buildContext());
    evaluator.evaluate.mockResolvedValue({
      dimensions: { accuracy: 1 }, overallScore: 1, failureCategories: ['WRONG_PAYMENT_STATE'], severity: 'CRITICAL',
      reasoning: 'False payment claim', confidence: 0.9, needsHumanReview: true, falseActionClaim: false,
      falseSuccessClaim: true, unnecessaryHandoff: false, customerCorrectionDetected: false,
    });

    await processor.process(buildJob());

    expect(internalTasks.create).toHaveBeenCalledTimes(1);
    expect(internalTasks.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ department: 'ai_review', priority: 'URGENT' }));
  });

  it('does not create a duplicate InternalTask when one already exists for this evaluation', async () => {
    const { processor, prisma, internalTasks, resolver, evaluator } = build();
    resolver.resolve.mockResolvedValue(buildContext());
    prisma.internalTask.findFirst.mockResolvedValue({ id: 'task-1' });
    evaluator.evaluate.mockResolvedValue({
      dimensions: { accuracy: 1 }, overallScore: 1, failureCategories: ['WRONG_PAYMENT_STATE'], severity: 'CRITICAL',
      reasoning: 'x', confidence: 0.9, needsHumanReview: true, falseActionClaim: false,
      falseSuccessClaim: true, unnecessaryHandoff: false, customerCorrectionDetected: false,
    });

    await processor.process(buildJob());

    expect(internalTasks.create).not.toHaveBeenCalled();
  });

  it('does not create an InternalTask for LOW/MEDIUM severity', async () => {
    const { processor, internalTasks, resolver, evaluator } = build();
    resolver.resolve.mockResolvedValue(buildContext());
    evaluator.evaluate.mockResolvedValue({
      dimensions: { accuracy: 4 }, overallScore: 4, failureCategories: ['TOO_VERBOSE'], severity: 'LOW',
      reasoning: 'x', confidence: 0.9, needsHumanReview: false, falseActionClaim: false,
      falseSuccessClaim: false, unnecessaryHandoff: false, customerCorrectionDetected: false,
    });

    await processor.process(buildJob());

    expect(internalTasks.create).not.toHaveBeenCalled();
  });
});
