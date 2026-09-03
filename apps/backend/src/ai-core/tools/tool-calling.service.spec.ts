import { AiProviderError } from '../providers/ai-provider.interface';
import { ToolCallingService } from './tool-calling.service';

function buildDeps() {
  const complete = jest.fn();
  return {
    registry: { forModel: jest.fn().mockReturnValue({ complete }) },
    complete,
    tools: { getDefs: jest.fn().mockReturnValue([{ name: 'search_products', description: 'd', parameters: {} }]), execute: jest.fn() },
    executions: { record: jest.fn().mockResolvedValue(null) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ToolCallingService(deps.registry as any, deps.tools as any, deps.executions as any);
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

    expect(result).toEqual({ content: 'We have labels in stock.', toolTrace: [], failed: false, hitMaxIterations: false });
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.executions.record).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', conversationId: 'c1', taskType: 'RESPONDER' }),
      expect.objectContaining({ status: 'SUCCESS' }),
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
    expect(result.toolTrace).toEqual([{ name: 'search_products', args: { query: 'labels' }, result: [{ id: 'p1', name: 'Label 95x175' }] }]);
    expect(deps.tools.execute).toHaveBeenCalledWith('search_products', baseReq().toolContext, { query: 'labels' });
    expect(deps.complete).toHaveBeenCalledTimes(2);

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

    expect(result).toEqual({ content: '', toolTrace: [], failed: true, hitMaxIterations: false });
    expect(deps.executions.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'PROVIDER_ERROR', errorCode: 'auth' }),
    );
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
});
