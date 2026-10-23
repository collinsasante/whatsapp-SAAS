import { AiExecutionsService } from './ai-executions.service';
import { newTrace } from '../pipeline/pipeline.types';

function buildPrismaMock() {
  let idCounter = 0;
  return {
    aiExecution: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: `exec-${++idCounter}`, ...data })),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
}

function buildDeps() {
  return {
    prisma: buildPrismaMock(),
    credits: { settleForExecution: jest.fn().mockResolvedValue({ settled: true, transaction: { id: 'txn-1' } }) },
    pricing: { getCreditsForUsage: jest.fn().mockResolvedValue(42) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AiExecutionsService(deps.prisma as any, deps.credits as any, deps.pricing as any);
}

describe('AiExecutionsService', () => {
  describe('record', () => {
    it('always writes the AiExecution row', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 100, outputTokens: 50 };

      const execution = await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, trace);

      expect(execution.id).toBeTruthy();
      expect(deps.prisma.aiExecution.create).toHaveBeenCalled();
    });

    it('settles credits for a RESPONDER trace using real token usage', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 100, outputTokens: 50 };

      const execution = await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, trace);

      expect(deps.pricing.getCreditsForUsage).toHaveBeenCalledWith('deepseek', 'm1', 100, 50);
      expect(deps.credits.settleForExecution).toHaveBeenCalledWith('t1', execution.id, 42, 'RESPONDER AI usage');
    });

    it('settles credits for a LEAD_SCORE trace too', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 10, outputTokens: 10 };

      await service.record({ tenantId: 't1', taskType: 'LEAD_SCORE' }, trace);

      expect(deps.credits.settleForExecution).toHaveBeenCalled();
    });

    it('never settles credits for admin/background task types (SUMMARIZE, KB_LEARN, TEST)', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 100, outputTokens: 50 };

      await service.record({ tenantId: 't1', taskType: 'SUMMARIZE' }, trace);
      await service.record({ tenantId: 't1', taskType: 'KB_LEARN' }, trace);
      await service.record({ tenantId: 't1', taskType: 'TEST' }, trace);

      expect(deps.credits.settleForExecution).not.toHaveBeenCalled();
      expect(deps.pricing.getCreditsForUsage).not.toHaveBeenCalled();
    });

    it('passes 0 tokens through for a failed trace, naturally charging nothing', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'PROVIDER_ERROR' as const, provider: 'deepseek', modelKey: 'm1' }; // no inputTokens/outputTokens

      await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, trace);

      expect(deps.pricing.getCreditsForUsage).toHaveBeenCalledWith('deepseek', 'm1', 0, 0);
    });

    it('still returns the execution row even if credit settlement throws -- tracing must never block a reply', async () => {
      const deps = buildDeps();
      deps.credits.settleForExecution.mockRejectedValue(new Error('db down'));
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 10, outputTokens: 10 };

      await expect(service.record({ tenantId: 't1', taskType: 'RESPONDER' }, trace)).resolves.toEqual(expect.objectContaining({ id: expect.any(String) }));
    });
  });
});
