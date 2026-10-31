import { AiProviderError } from '../providers/ai-provider.interface';
import { ToolCallingService } from './tool-calling.service';

function buildDeps() {
  const complete = jest.fn();
  let reservationCounter = 0;
  return {
    registry: { forModel: jest.fn().mockReturnValue({ complete }) },
    complete,
    meteredProvider: {
      complete: jest.fn(async (provider: { complete: (request: unknown) => Promise<unknown> }, _tenantId: string, _taskType: string, request: unknown) => ({
        result: await provider.complete(request),
        reservationId: `reservation-${++reservationCounter}`,
      })),
    },
    tools: { getDefs: jest.fn().mockReturnValue([{ name: 'search_products', description: 'd', parameters: {} }]), execute: jest.fn() },
    executions: { record: jest.fn().mockResolvedValue(null) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ToolCallingService(deps.registry as any, deps.tools as any, deps.executions as any, deps.meteredProvider as any);
}

function baseReq(overrides: Partial<Parameters<ToolCallingService['complete']>[0]> = {}) {
  return {
    tenantId: 't1',
    taskType: 'RESPONDER' as const,
    conversationId: 'c1',
    systemPrompt: 'You are a shop assistant.',
    historyMessages: [],
    userMessage: 'do you have labels?',
    toolNames: ['search_products'],
    toolContext: { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233555000111' },
    ...overrides,
  };
}

const mockCompletion = (overrides: Record<string, unknown> = {}) => ({
  content: '', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5 },
  provider: 'deepseek', model: 'deepseek-v4-flash', latencyMs: 5,
  ...overrides,
});

describe('ToolCallingService', () => {
  it('returns the final answer directly when the model calls no tools', async () => {
    const deps = buildDeps();
    deps.complete.mockResolvedValue(mockCompletion({ content: 'We have labels in stock.' }));
    const service = buildService(deps);

    const result = await service.complete(baseReq());

    expect(result).toEqual({ content: 'We have labels in stock.', toolTrace: [], failed: false, hitMaxIterations: false, sideEffects: [] });
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.executions.record).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', conversationId: 'c1', taskType: 'RESPONDER' }),
      expect.objectContaining({ status: 'SUCCESS', reservationIds: ['reservation-1'] }),
    );
  });

  it('executes a tool call, feeds the result back, and returns the follow-up answer', async () => {
    const deps = buildDeps();
    deps.complete
      .mockResolvedValueOnce(mockCompletion({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'search_products', arguments: '{"query":"labels"}' }],
        finishReason: 'tool_calls',
      }))
      .mockResolvedValueOnce(mockCompletion({ content: 'Yes, we have 95x175mm labels at GHS2.15 each.' }));
    deps.tools.execute.mockResolvedValue([{ id: 'p1', name: 'Label 95x175' }]);
    const service = buildService(deps);

    const result = await service.complete(baseReq());

    expect(result.content).toBe('Yes, we have 95x175mm labels at GHS2.15 each.');
    expect(result.toolTrace).toEqual([{ name: 'search_products', args: { query: 'labels' }, result: [{ id: 'p1', name: 'Label 95x175' }], durationMs: expect.any(Number) }]);
    expect(deps.tools.execute).toHaveBeenCalledWith('search_products', baseReq().toolContext, { query: 'labels' });
    expect(deps.complete).toHaveBeenCalledTimes(2);
    expect(deps.executions.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reservationIds: ['reservation-1', 'reservation-2'] }),
    );

    // second call must include the assistant tool-call turn and the tool result turn
    const secondCallMessages = deps.complete.mock.calls[1][0].messages;
    expect(secondCallMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', toolCalls: [{ id: 'call-1', name: 'search_products', arguments: '{"query":"labels"}' }] }),
      expect.objectContaining({ role: 'tool', toolCallId: 'call-1' }),
    ]));
  });

  it('stops after maxIterations and reports hitMaxIterations without throwing', async () => {
    const deps = buildDeps();
    deps.complete.mockResolvedValue(mockCompletion({
      content: '', toolCalls: [{ id: 'call-x', name: 'search_products', arguments: '{}' }], finishReason: 'tool_calls',
    }));
    deps.tools.execute.mockResolvedValue({ ok: true });
    const service = buildService(deps);

    const result = await service.complete(baseReq({ maxIterations: 2 }));

    expect(result.hitMaxIterations).toBe(true);
    expect(result.failed).toBe(false);
    expect(deps.complete).toHaveBeenCalledTimes(2);
  });

  it('returns failed:true on a provider error and never throws', async () => {
    const deps = buildDeps();
    deps.complete.mockRejectedValue(new AiProviderError('auth', 'bad key', false));
    const service = buildService(deps);

    const result = await service.complete(baseReq());

    expect(result).toEqual({ content: '', toolTrace: [], failed: true, hitMaxIterations: false, sideEffects: [] });
    expect(deps.executions.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'PROVIDER_ERROR', errorCode: 'auth' }),
    );
  });

  describe('returns the id of the execution it recorded, so the caller can link it to the interaction log', () => {
    it('on a normal answer', async () => {
      const deps = buildDeps();
      deps.executions.record.mockResolvedValue({ id: 'exec-77' });
      deps.complete.mockResolvedValue(mockCompletion({ content: 'We have labels in stock.' }));
      expect((await buildService(deps).complete(baseReq())).executionId).toBe('exec-77');
    });

    it('on a provider failure', async () => {
      const deps = buildDeps();
      deps.executions.record.mockResolvedValue({ id: 'exec-78' });
      deps.complete.mockRejectedValue(new AiProviderError('auth', 'bad key', false));
      const result = await buildService(deps).complete(baseReq());
      expect(result.failed).toBe(true);
      expect(result.executionId).toBe('exec-78');
    });

    it('when the loop runs out of iterations', async () => {
      const deps = buildDeps();
      deps.executions.record.mockResolvedValue({ id: 'exec-79' });
      deps.complete.mockResolvedValue(mockCompletion({ toolCalls: [{ id: 'call-1', name: 'search_products', arguments: '{}' }] }));
      deps.tools.execute.mockResolvedValue({ ok: true });
      const result = await buildService(deps).complete(baseReq({ maxIterations: 2 }));
      expect(result.hitMaxIterations).toBe(true);
      expect(result.executionId).toBe('exec-79');
    });

    it('has no id, and still answers, when recording fails', async () => {
      const deps = buildDeps();
      deps.executions.record.mockRejectedValue(new Error('db down'));
      deps.complete.mockResolvedValue(mockCompletion({ content: 'We have labels in stock.' }));
      const result = await buildService(deps).complete(baseReq());
      expect(result.content).toBe('We have labels in stock.');
      expect(result.executionId).toBeUndefined();
    });
  });

  it('records a simulated run with safetyFlags.simulated, and a real run with none', async () => {
    const sim = buildDeps();
    sim.complete.mockResolvedValue(mockCompletion({ content: 'We have labels in stock.' }));
    await buildService(sim).complete(baseReq({ taskType: 'TEST' as never, simulated: true }));
    expect(sim.executions.record).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'TEST' }), expect.objectContaining({ safetyFlags: { simulated: true } }));

    const real = buildDeps();
    real.complete.mockResolvedValue(mockCompletion({ content: 'We have labels in stock.' }));
    await buildService(real).complete(baseReq());
    expect(real.executions.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ safetyFlags: {} }));
  });

  it('malformed tool-call arguments do not crash the loop', async () => {
    const deps = buildDeps();
    deps.complete
      .mockResolvedValueOnce(mockCompletion({
        content: '', toolCalls: [{ id: 'call-1', name: 'search_products', arguments: 'not json' }], finishReason: 'tool_calls',
      }))
      .mockResolvedValueOnce(mockCompletion({ content: 'done' }));
    deps.tools.execute.mockResolvedValue({ error: 'bad args' });
    const service = buildService(deps);

    const result = await service.complete(baseReq());

    expect(result.content).toBe('done');
    expect(deps.tools.execute).toHaveBeenCalledWith('search_products', expect.anything(), {});
  });
  describe('the final answer is judged before the execution is recorded', () => {
    const lastRecordedTrace = (deps: ReturnType<typeof buildDeps>) => deps.executions.record.mock.calls[deps.executions.record.mock.calls.length - 1][1];

    it.each([
      ['an empty answer', '', 'empty'],
      ['a whitespace-only answer', '   \n\t ', 'empty'],
      ['a JSON-like answer', '{"response":"Hello Kwame! Our shea butter comes in two sizes', 'malformed'],
      ['an error-like answer', 'Error: connect ETIMEDOUT 10.0.0.1:443', 'internal_error'],
    ])('records %s as a failed execution, not SUCCESS, and flags it for the caller', async (_name, content, reason) => {
      const deps = buildDeps();
      deps.complete.mockResolvedValue(mockCompletion({ content, finishReason: 'stop' }));

      const result = await buildService(deps).complete(baseReq());

      expect(result.outputProblem).toBe(reason);
      expect(result.failed).toBe(false);
      expect(deps.executions.record).toHaveBeenCalledTimes(1);
      expect(lastRecordedTrace(deps)).toEqual(expect.objectContaining({ status: 'PROVIDER_ERROR', errorCode: 'parse_error', errorMessage: `Model output rejected: ${reason}` }));
    });

    it('treats finish_reason=length as truncation even when what was written reads as a clean sentence', async () => {
      const deps = buildDeps();
      deps.complete.mockResolvedValue(mockCompletion({ content: 'Our shea butter comes in two sizes, 250g for GHS 45 and', finishReason: 'length' }));

      const result = await buildService(deps).complete(baseReq());

      expect(result.outputProblem).toBe('truncated');
      expect(result.content).toBe('Our shea butter comes in two sizes, 250g for GHS 45 and'); // kept for diagnosis; callers must not send it
      expect(lastRecordedTrace(deps)).toEqual(expect.objectContaining({ status: 'PROVIDER_ERROR', errorCode: 'parse_error', errorMessage: 'Model output rejected: truncated' }));
    });

    it('calls a reply that used its whole budget before writing anything truncated, not blank', async () => {
      const deps = buildDeps();
      deps.complete.mockResolvedValue(mockCompletion({ content: '', finishReason: 'length' }));

      expect((await buildService(deps).complete(baseReq())).outputProblem).toBe('truncated');
    });

    it('keeps the evidence of a rejected answer: tokens, reservation, tool trace and execution id', async () => {
      const deps = buildDeps();
      deps.executions.record.mockResolvedValue({ id: 'exec-9' });
      deps.complete
        .mockResolvedValueOnce(mockCompletion({ toolCalls: [{ id: 'call-1', name: 'search_products', arguments: '{"query":"labels"}' }], finishReason: 'tool_calls' }))
        .mockResolvedValueOnce(mockCompletion({ content: 'Yes, we have labels at', finishReason: 'length', usage: { inputTokens: 20, outputTokens: 400 } }));
      deps.tools.execute.mockResolvedValue([{ id: 'p1' }]);

      const result = await buildService(deps).complete(baseReq());

      expect(result.executionId).toBe('exec-9');
      expect(deps.executions.record).toHaveBeenCalledTimes(1);
      expect(lastRecordedTrace(deps)).toEqual(expect.objectContaining({
        status: 'PROVIDER_ERROR', inputTokens: 30, outputTokens: 405, reservationIds: ['reservation-1', 'reservation-2'],
        toolTrace: [expect.objectContaining({ name: 'search_products' })],
      }));
    });

    it('does not judge a tool-call turn: an intermediate response (even one that stopped at the limit) is not a customer answer', async () => {
      const deps = buildDeps();
      deps.complete
        .mockResolvedValueOnce(mockCompletion({ content: '', toolCalls: [{ id: 'call-1', name: 'search_products', arguments: '{}' }], finishReason: 'tool_calls' }))
        .mockResolvedValueOnce(mockCompletion({ content: 'Yes, we have labels.', finishReason: 'stop' }));
      deps.tools.execute.mockResolvedValue([]);

      const result = await buildService(deps).complete(baseReq());

      expect(result.outputProblem).toBeUndefined();
      expect(result.content).toBe('Yes, we have labels.');
      expect(deps.executions.record).toHaveBeenCalledTimes(1);
      expect(lastRecordedTrace(deps)).toEqual(expect.objectContaining({ status: 'SUCCESS' }));
      expect(lastRecordedTrace(deps).errorCode).toBeUndefined();
    });

    it('a valid answer is still SUCCESS, and a finish reason other than length is not treated as truncation', async () => {
      for (const finishReason of ['stop', 'content_filter', 'other']) {
        const deps = buildDeps();
        deps.complete.mockResolvedValue(mockCompletion({ content: 'We have labels in stock.', finishReason }));

        const result = await buildService(deps).complete(baseReq());

        expect(result.outputProblem).toBeUndefined();
        expect(lastRecordedTrace(deps)).toEqual(expect.objectContaining({ status: 'SUCCESS' }));
      }
    });

    it('does not touch the iteration-limit and provider-failure outcomes', async () => {
      const limit = buildDeps();
      limit.complete.mockResolvedValue(mockCompletion({ toolCalls: [{ id: 'c', name: 'search_products', arguments: '{}' }], finishReason: 'tool_calls' }));
      limit.tools.execute.mockResolvedValue({});
      const limited = await buildService(limit).complete(baseReq({ maxIterations: 2 }));
      expect(limited).toEqual(expect.objectContaining({ hitMaxIterations: true, failed: false }));
      expect(limited.outputProblem).toBeUndefined();

      const down = buildDeps();
      down.complete.mockRejectedValue(new AiProviderError('timeout', 'slow', true));
      const failed = await buildService(down).complete(baseReq());
      expect(failed).toEqual(expect.objectContaining({ failed: true }));
      expect(failed.outputProblem).toBeUndefined();
    });
  });
});
