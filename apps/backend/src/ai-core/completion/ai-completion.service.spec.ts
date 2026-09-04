import { AiCompletionService } from './ai-completion.service';
import { MockProvider } from '../providers/mock.provider';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { AiProviderError } from '../providers/ai-provider.interface';
import { DEFAULT_MODEL_KEY } from '../models/model-catalog';

function buildExecutionsMock() {
  return { record: jest.fn().mockResolvedValue({ id: 'exec-1' }) };
}

describe('AiCompletionService', () => {
  let provider: MockProvider;
  let executions: ReturnType<typeof buildExecutionsMock>;
  let service: AiCompletionService;

  beforeEach(() => {
    provider = new MockProvider();
    (provider as { key: string }).key = 'deepseek';
    executions = buildExecutionsMock();
    const registry = new ProviderRegistryService(provider as never);
    service = new AiCompletionService(registry, executions as never);
  });

  it('returns the completion content and records a SUCCESS trace', async () => {
    provider.nextResult = {
      content: 'Executive brief text', toolCalls: [], finishReason: 'stop',
      usage: { inputTokens: 500, outputTokens: 200 }, provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 3,
    };

    const result = await service.complete({ tenantId: 't1', taskType: 'SUMMARIZE', conversationId: 'c1', messages: [{ role: 'user', content: 'summarize this' }] });

    expect(result).toEqual({ content: 'Executive brief text', failed: false });
    expect(executions.record).toHaveBeenCalledTimes(1);
    const [input, trace] = executions.record.mock.calls[0];
    expect(input).toEqual({ tenantId: 't1', conversationId: 'c1', taskType: 'SUMMARIZE' });
    expect(trace.status).toBe('SUCCESS');
    expect(trace.inputTokens).toBe(500);
    expect(trace.outputTokens).toBe(200);
    expect(trace.estCostUsd).toBeGreaterThan(0);
  });

  it('never throws on a provider error -- returns failed:true and records PROVIDER_ERROR', async () => {
    provider.nextError = new AiProviderError('auth', 'DeepSeek authentication failed', false);

    const result = await service.complete({ tenantId: 't1', taskType: 'KB_LEARN', messages: [{ role: 'user', content: 'extract articles' }] });

    expect(result).toEqual({ content: '', failed: true });
    const [, trace] = executions.record.mock.calls[0];
    expect(trace.status).toBe('PROVIDER_ERROR');
    expect(trace.errorCode).toBe('auth');
  });

  it('does not throw even if trace recording itself fails', async () => {
    executions.record.mockRejectedValue(new Error('db down'));
    provider.nextResult = { content: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 1 };

    await expect(service.complete({ tenantId: 't1', taskType: 'SUMMARIZE', messages: [] })).resolves.toEqual({ content: 'ok', failed: false });
  });

  it('defaults to DEFAULT_MODEL_KEY when no modelKey is specified', async () => {
    provider.nextResult = { content: 'x', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 1 };

    await service.complete({ tenantId: 't1', taskType: 'TEST', messages: [] });

    expect(provider.calls[0].modelKey).toBe(DEFAULT_MODEL_KEY);
  });
});
