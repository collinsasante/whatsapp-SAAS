import { AiLearningService } from './ai-learning.service';

function buildPrismaMock() {
  return {
    aiInteractionEvaluation: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _avg: { overallScore: null } }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    aiEvaluationFeedback: { upsert: jest.fn().mockResolvedValue({ id: 'fb-1' }) },
    aiCustomerCorrection: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'corr-1' }), findMany: jest.fn().mockResolvedValue([]) },
    aiTrainingExample: { create: jest.fn().mockResolvedValue({ id: 'te-1' }), update: jest.fn().mockResolvedValue({}), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    aiLearningAuditLog: { create: jest.fn().mockResolvedValue({}) },
    aiInteractionLog: { findUnique: jest.fn() },
  };
}

function build() {
  const prisma = buildPrismaMock();
  const service = new AiLearningService(prisma as never);
  return { service, prisma };
}

describe('AiLearningService — tenant isolation', () => {
  it('submitFeedback throws NotFoundException when the evaluation belongs to a different tenant', async () => {
    const { service, prisma } = build();
    // findFirst is called WITH a tenantId filter -- a real Prisma call would
    // correctly return null for a cross-tenant id; this simulates that.
    prisma.aiInteractionEvaluation.findFirst.mockResolvedValue(null);

    await expect(
      service.submitFeedback('tenant-a', 'eval-owned-by-tenant-b', { reviewerId: 'user-1', rating: 'GOOD' }),
    ).rejects.toThrow('Evaluation not found');

    expect(prisma.aiInteractionEvaluation.findFirst).toHaveBeenCalledWith({ where: { id: 'eval-owned-by-tenant-b', tenantId: 'tenant-a' } });
    expect(prisma.aiEvaluationFeedback.upsert).not.toHaveBeenCalled();
  });

  it('getInteraction scopes the lookup by tenantId, not just by id', async () => {
    const { service, prisma } = build();
    prisma.aiInteractionEvaluation.findFirst.mockResolvedValue(null);

    await expect(service.getInteraction('tenant-a', 'eval-1')).rejects.toThrow('Evaluation not found');
    const call = prisma.aiInteractionEvaluation.findFirst.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'eval-1', tenantId: 'tenant-a' });
  });

  it('listInteractions always filters by tenantId even with no other filters given', async () => {
    const { service, prisma } = build();
    await service.listInteractions('tenant-a', {});
    const call = prisma.aiInteractionEvaluation.findMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe('tenant-a');
  });

  it('recordCorrection is scoped to the evaluation tenant and rejects a cross-tenant evaluation id', async () => {
    const { service, prisma } = build();
    prisma.aiInteractionEvaluation.findFirst.mockResolvedValue(null);

    await expect(
      service.recordCorrection('tenant-a', 'eval-owned-by-tenant-b', { correctionMessageId: 'msg-1', category: 'CUSTOMER_CORRECTION' }),
    ).rejects.toThrow('Evaluation not found');
    expect(prisma.aiCustomerCorrection.create).not.toHaveBeenCalled();
  });
});

describe('AiLearningService — feedback / status transitions', () => {
  it('a GOOD rating moves the evaluation to APPROVED', async () => {
    const { service, prisma } = build();
    prisma.aiInteractionEvaluation.findFirst.mockResolvedValue({ id: 'eval-1', status: 'NEEDS_REVIEW' });

    await service.submitFeedback('tenant-a', 'eval-1', { reviewerId: 'user-1', rating: 'GOOD' });

    expect(prisma.aiInteractionEvaluation.update).toHaveBeenCalledWith({ where: { id: 'eval-1' }, data: { status: 'APPROVED' } });
  });

  it('a BAD rating moves the evaluation to REJECTED', async () => {
    const { service, prisma } = build();
    prisma.aiInteractionEvaluation.findFirst.mockResolvedValue({ id: 'eval-1', status: 'NEEDS_REVIEW' });

    await service.submitFeedback('tenant-a', 'eval-1', { reviewerId: 'user-1', rating: 'BAD', reason: 'WRONG_PRODUCT' });

    expect(prisma.aiInteractionEvaluation.update).toHaveBeenCalledWith({ where: { id: 'eval-1' }, data: { status: 'REJECTED' } });
  });

  it('createTrainingExample refuses an evaluation with no feedback yet', async () => {
    const { service, prisma } = build();
    prisma.aiInteractionEvaluation.findFirst.mockResolvedValue({ id: 'eval-1', feedback: null, aiExecution: { interactionLogId: null } });

    await expect(service.createTrainingExample('tenant-a', 'eval-1', 'user-1')).rejects.toThrow(/human feedback/);
    expect(prisma.aiTrainingExample.create).not.toHaveBeenCalled();
  });

  it('markRegressionCaseCreated refuses a training example that is not yet APPROVED', async () => {
    const { service, prisma } = build();
    prisma.aiTrainingExample.findFirst.mockResolvedValue({ id: 'te-1', status: 'DRAFT' });

    await expect(service.markRegressionCaseCreated('tenant-a', 'te-1', 'user-1')).rejects.toThrow(/APPROVED/);
  });
});
