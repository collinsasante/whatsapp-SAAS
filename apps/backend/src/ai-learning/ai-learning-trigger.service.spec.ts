import { AiLearningTriggerService, AI_LEARNING_FLAG_KEY } from './ai-learning-trigger.service';

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
