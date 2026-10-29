import { AiLearningTriggerService, AI_LEARNING_FLAG_KEY, evalJobId } from './ai-learning-trigger.service';

function build() {
  const featureFlags = { isEnabledCached: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new AiLearningTriggerService(featureFlags as never, queue as never);
  return { service, featureFlags, queue };
}

describe('AiLearningTriggerService', () => {
  it('does not enqueue when the tenant flag is off (fail closed by default)', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(false);

    await service.maybeEnqueue({ tenantId: 'other-tenant', aiExecutionId: 'exec-1', taskType: 'RESPONDER', conversationId: 'conv-1' });

    expect(featureFlags.isEnabledCached).toHaveBeenCalledWith(AI_LEARNING_FLAG_KEY, 'other-tenant');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueues when the tenant flag is on and the task type is RESPONDER', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);

    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'RESPONDER', conversationId: 'conv-1' });

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('evaluate', { aiExecutionId: 'exec-1', tenantId: 'pakkmax-id' }, expect.any(Object));
  });

  it('enqueues with a stable job id derived from the execution id (idempotent enqueue)', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);

    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: '0b9f5b9e-1c2d-4e5f-8a6b-7c8d9e0f1a2b', taskType: 'RESPONDER', conversationId: 'conv-1' });
    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: '0b9f5b9e-1c2d-4e5f-8a6b-7c8d9e0f1a2b', taskType: 'RESPONDER', conversationId: 'conv-1' });

    const ids = queue.add.mock.calls.map((c: unknown[]) => (c[2] as { jobId: string }).jobId);
    expect(ids).toEqual(['ai-interaction-eval-0b9f5b9e-1c2d-4e5f-8a6b-7c8d9e0f1a2b', 'ai-interaction-eval-0b9f5b9e-1c2d-4e5f-8a6b-7c8d9e0f1a2b']);
    // Different executions never share an id; the retry/backoff options are unchanged.
    expect(evalJobId('a')).not.toBe(evalJobId('b'));
    expect(queue.add.mock.calls[0][2]).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 5_000 } });
  });

  it('the job id is accepted by BullMQ: not an integer and without a colon', () => {
    // These are the two rules BullMQ 5 enforces on custom ids (Job.validateOptions).
    for (const id of ['exec-1', '0b9f5b9e-1c2d-4e5f-8a6b-7c8d9e0f1a2b', '12345']) {
      const jobId = evalJobId(id);
      expect(`${parseInt(jobId, 10)}`).not.toBe(jobId);
      expect(jobId.includes(':')).toBe(false);
    }
  });

  it('enqueues a SUCCESS execution', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);
    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'RESPONDER', conversationId: 'conv-1', status: 'SUCCESS' });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it.each(['BLOCKED', 'EMPTY', 'PROVIDER_ERROR', 'POLICY_REJECTED'])('does not queue a %s execution: there is no reply to grade, only a job that would fail', async (status) => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);
    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'RESPONDER', conversationId: 'conv-1', status });
    expect(queue.add).not.toHaveBeenCalled();
    expect(featureFlags.isEnabledCached).not.toHaveBeenCalled();
  });

  it('evaluates a simulated TEST run (an AI Test Chat reply), because it is a real conversational turn that settles no credits', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);
    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'TEST', conversationId: 'conv-1', status: 'SUCCESS', simulated: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it.each([[undefined], [false]])('does not evaluate any other TEST run (simulated: %p): admin sandboxes and evaluation harnesses are not customer turns', async (simulated) => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);
    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'TEST', conversationId: 'conv-1', status: 'SUCCESS', simulated });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each(['SUMMARIZE', 'KB_LEARN', 'LEAD_SCORE'])('the simulated tag does not make %s evaluable', async (taskType) => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);
    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType, conversationId: 'conv-1', status: 'SUCCESS', simulated: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('a simulated run is still gated by the tenant flag and by status', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(false);
    await service.maybeEnqueue({ tenantId: 'other', aiExecutionId: 'exec-1', taskType: 'TEST', conversationId: 'conv-1', status: 'SUCCESS', simulated: true });
    featureFlags.isEnabledCached.mockResolvedValue(true);
    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-2', taskType: 'TEST', conversationId: 'conv-1', status: 'PROVIDER_ERROR', simulated: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  describe('the paid judge on a SIMULATED reply draws on the tenant\'s daily simulated-evaluation budget', () => {
    const withLimits = (reserve: jest.Mock) => {
      const featureFlags = { isEnabledCached: jest.fn().mockResolvedValue(true) };
      const queue = { add: jest.fn().mockResolvedValue(undefined) };
      const service = new AiLearningTriggerService(featureFlags as never, queue as never, { reserveEvaluation: reserve } as never);
      return { service, featureFlags, queue, reserve };
    };
    const simulated = { tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'TEST', conversationId: 'conv-1', status: 'SUCCESS', simulated: true };

    it('grades the reply and takes one unit when the budget allows', async () => {
      const { service, queue, reserve } = withLimits(jest.fn().mockResolvedValue(true));
      await service.maybeEnqueue(simulated);
      expect(reserve).toHaveBeenCalledWith('pakkmax-id');
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('skips only the grading, not the reply, when the budget is spent or unavailable', async () => {
      const { service, queue } = withLimits(jest.fn().mockResolvedValue(false));
      await expect(service.maybeEnqueue(simulated)).resolves.toBeUndefined();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('takes no unit when the tenant flag is off (a disabled tenant is not charged)', async () => {
      const { service, featureFlags, reserve, queue } = withLimits(jest.fn().mockResolvedValue(true));
      featureFlags.isEnabledCached.mockResolvedValue(false);
      await service.maybeEnqueue(simulated);
      expect(reserve).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('takes no unit for a non-evaluable run', async () => {
      const { service, reserve } = withLimits(jest.fn().mockResolvedValue(true));
      await service.maybeEnqueue({ ...simulated, status: 'PROVIDER_ERROR' });
      await service.maybeEnqueue({ ...simulated, taskType: 'SUMMARIZE' });
      expect(reserve).not.toHaveBeenCalled();
    });

    it('a REAL customer reply is never counted against the simulated budget', async () => {
      const { service, reserve, queue } = withLimits(jest.fn().mockResolvedValue(false));
      await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-2', taskType: 'RESPONDER', conversationId: 'conv-1', status: 'SUCCESS' });
      await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-3', taskType: 'RESPONDER', conversationId: 'conv-1', status: 'SUCCESS', simulated: false });
      expect(reserve).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('without the limits service (older wiring) behaves as before', async () => {
      const featureFlags = { isEnabledCached: jest.fn().mockResolvedValue(true) };
      const queue = { add: jest.fn().mockResolvedValue(undefined) };
      await new AiLearningTriggerService(featureFlags as never, queue as never).maybeEnqueue(simulated);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('never throws if the budget check itself throws', async () => {
      const { service, queue } = withLimits(jest.fn().mockRejectedValue(new Error('boom')));
      await expect(service.maybeEnqueue(simulated)).resolves.toBeUndefined();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  it('never enqueues non-RESPONDER task types even when the flag is on', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);

    for (const taskType of ['SUMMARIZE', 'KB_LEARN', 'TEST', 'LEAD_SCORE']) {
      await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType, conversationId: 'conv-1' });
    }

    expect(queue.add).not.toHaveBeenCalled();
    // Never even checks the flag for non-evaluable task types -- cheaper and
    // avoids an unnecessary flag lookup on every KB-learn/summarize call.
    expect(featureFlags.isEnabledCached).not.toHaveBeenCalled();
  });

  it('never enqueues when there is no conversationId', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);

    await service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'RESPONDER', conversationId: null });

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('never throws even if the feature flag lookup itself fails', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockRejectedValue(new Error('db down'));

    await expect(
      service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'RESPONDER', conversationId: 'conv-1' }),
    ).resolves.toBeUndefined();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('never throws even if the queue itself fails to accept the job', async () => {
    const { service, featureFlags, queue } = build();
    featureFlags.isEnabledCached.mockResolvedValue(true);
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(
      service.maybeEnqueue({ tenantId: 'pakkmax-id', aiExecutionId: 'exec-1', taskType: 'RESPONDER', conversationId: 'conv-1' }),
    ).resolves.toBeUndefined();
  });
});
