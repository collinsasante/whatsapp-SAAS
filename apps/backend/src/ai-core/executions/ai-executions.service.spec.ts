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
    credits: {
      settleForExecution: jest.fn().mockResolvedValue({ settled: true, transaction: { id: 'txn-1' } }),
      linkReservationsToExecution: jest.fn().mockResolvedValue(undefined),
    },
    pricing: { getCreditsForUsage: jest.fn().mockResolvedValue(42) },
    aiLearningTrigger: { maybeEnqueue: jest.fn().mockResolvedValue(undefined) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AiExecutionsService(deps.prisma as any, deps.credits as any, deps.pricing as any, deps.aiLearningTrigger as any);
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

    it('second hardening pass, Section 2: persists toolTrace when the trace includes one', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const sanitizedTrace = [{ name: 'search_products', order: 0, input: { query: 'bag' }, result: [], success: true, durationMs: 12 }];
      const trace = { ...newTrace(), status: 'SUCCESS' as const, toolTrace: sanitizedTrace };

      await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, trace);

      expect(deps.prisma.aiExecution.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ toolTrace: sanitizedTrace }),
      }));
    });

    it('leaves toolTrace undefined for a non-tool-calling turn', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'SUCCESS' as const };

      await service.record({ tenantId: 't1', taskType: 'SUMMARIZE' }, trace);

      expect(deps.prisma.aiExecution.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ toolTrace: undefined }),
      }));
    });

    it('meterCredits:false records the execution but settles nothing (for callers already charged by their own hold)', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 100, outputTokens: 50 };

      const execution = await service.record({ tenantId: 't1', taskType: 'RESPONDER', conversationId: 'c1' }, trace, { meterCredits: false });

      expect(execution.id).toBe('exec-1');
      expect(deps.prisma.aiExecution.create).toHaveBeenCalledTimes(1);
      expect(deps.pricing.getCreditsForUsage).not.toHaveBeenCalled();
      expect(deps.credits.settleForExecution).not.toHaveBeenCalled();
      expect(deps.credits.linkReservationsToExecution).not.toHaveBeenCalled();
    });

    it('meterCredits:false also skips reservation linking and failure settlement', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, { ...newTrace(), status: 'PROVIDER_ERROR' as const, reservationIds: ['r1'] }, { meterCredits: false });
      expect(deps.credits.settleForExecution).not.toHaveBeenCalled();
      expect(deps.credits.linkReservationsToExecution).not.toHaveBeenCalled();
    });

    it('without options, a RESPONDER execution is still metered exactly as before', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, { ...newTrace(), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 1, outputTokens: 1 });
      expect(deps.credits.settleForExecution).toHaveBeenCalledTimes(1);
    });

    it('tells the evaluation trigger a run was simulated, from the trace', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      await service.record({ tenantId: 't1', taskType: 'TEST', conversationId: 'c1' }, { ...newTrace(true), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 5, outputTokens: 5 });
      expect(deps.aiLearningTrigger.maybeEnqueue).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'TEST', simulated: true, status: 'SUCCESS' }));
      expect(deps.credits.settleForExecution).not.toHaveBeenCalled(); // TEST is unmetered by the existing rule
      expect(deps.pricing.getCreditsForUsage).not.toHaveBeenCalled();
    });

    it('a real run reports simulated:false', async () => {
      const deps = buildDeps();
      await buildService(deps).record({ tenantId: 't1', taskType: 'RESPONDER', conversationId: 'c1' }, { ...newTrace(), status: 'SUCCESS' as const });
      expect(deps.aiLearningTrigger.maybeEnqueue).toHaveBeenCalledWith(expect.objectContaining({ simulated: false }));
    });

    it('persists the simulated tag with the execution', async () => {
      const deps = buildDeps();
      await buildService(deps).record({ tenantId: 't1', taskType: 'TEST', conversationId: 'c1' }, { ...newTrace(true), status: 'SUCCESS' as const });
      expect(deps.prisma.aiExecution.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ safetyFlags: { simulated: true } }) }));
    });

    it('tells the evaluation trigger the execution\'s status', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      await service.record({ tenantId: 't1', taskType: 'RESPONDER', conversationId: 'c1' }, { ...newTrace(), status: 'PROVIDER_ERROR' as const });
      expect(deps.aiLearningTrigger.maybeEnqueue).toHaveBeenCalledWith(expect.objectContaining({ aiExecutionId: 'exec-1', taskType: 'RESPONDER', conversationId: 'c1', status: 'PROVIDER_ERROR' }));
    });

    it('settles credits for a RESPONDER trace using real token usage', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'SUCCESS' as const, provider: 'deepseek', modelKey: 'm1', inputTokens: 100, outputTokens: 50 };

      const execution = await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, trace);

      expect(deps.pricing.getCreditsForUsage).toHaveBeenCalledWith('deepseek', 'm1', 100, 50);
      expect(deps.credits.settleForExecution).toHaveBeenCalledWith('t1', execution.id, 42, 'RESPONDER AI usage');
    });

    it('links provider reservations to the execution without charging usage a second time', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = {
        ...newTrace(),
        status: 'SUCCESS' as const,
        provider: 'deepseek',
        modelKey: 'm1',
        inputTokens: 100,
        outputTokens: 50,
        reservationIds: ['reservation-1', 'reservation-2'],
      };

      const execution = await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, trace);

      expect(deps.credits.linkReservationsToExecution).toHaveBeenCalledWith('t1', execution.id, trace.reservationIds);
      expect(deps.pricing.getCreditsForUsage).not.toHaveBeenCalled();
      expect(deps.credits.settleForExecution).not.toHaveBeenCalled();
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

    it('records a zero-credit settlement for a failed trace without a provider reservation', async () => {
      const deps = buildDeps();
      const service = buildService(deps);
      const trace = { ...newTrace(), status: 'PROVIDER_ERROR' as const, provider: 'deepseek', modelKey: 'm1' }; // no inputTokens/outputTokens

      await service.record({ tenantId: 't1', taskType: 'RESPONDER' }, trace);

      expect(deps.credits.settleForExecution).toHaveBeenCalledWith('t1', 'exec-1', 0, 'RESPONDER AI usage');
      expect(deps.pricing.getCreditsForUsage).not.toHaveBeenCalled();
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
