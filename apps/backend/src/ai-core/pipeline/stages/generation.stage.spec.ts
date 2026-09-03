import { GenerationStage } from './generation.stage';
import { newTrace, PipelineContext } from '../pipeline.types';
import { DEFAULT_MODEL_KEY } from '../../models/model-catalog';

function buildCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    input: { tenantId: 't1', agentId: 'a1', conversationId: 'c1', customerMessage: 'hi', taskType: 'RESPONDER' },
    businessName: 'Acme',
    personality: '',
    systemInstructions: '',
    modelKey: DEFAULT_MODEL_KEY,
    maxResponseTokens: 400,
    customerMessage: 'hi',
    historyMessages: [],
    knowledgeContext: '',
    renderedSystemPrompt: 'You are a shop assistant.',
    shortCircuit: false,
    trace: newTrace(),
    ...overrides,
  };
}

describe('GenerationStage', () => {
  describe('without tools (unchanged behavior)', () => {
    it('parses a {response, confidence} JSON completion', async () => {
      const registry = { forModel: jest.fn().mockReturnValue({ complete: jest.fn().mockResolvedValue({
        content: '{"response":"Delivery is GHS 30.","confidence":90}', toolCalls: [], finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 }, provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 5,
      }) }) };
      const toolCalling = { complete: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage(registry as any, toolCalling as any);
      const ctx = buildCtx();

      await stage.execute(ctx);

      expect(ctx.result).toEqual({ response: 'Delivery is GHS 30.', confidence: 90, blocked: false });
      expect(toolCalling.complete).not.toHaveBeenCalled();
    });
  });

  describe('with tools (Verz-AI unification, Phase A)', () => {
    const toolContext = { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233555000111' };

    it('delegates to ToolCallingService and uses its plain-text result as the response', async () => {
      const registry = { forModel: jest.fn() };
      const toolCalling = { complete: jest.fn().mockResolvedValue({ content: 'We have that in stock.', toolTrace: [], failed: false, hitMaxIterations: false }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage(registry as any, toolCalling as any);
      const ctx = buildCtx({ tools: ['search_products'], toolContext });

      await stage.execute(ctx);

      expect(ctx.result).toEqual({ response: 'We have that in stock.', confidence: null, blocked: false });
      expect(ctx.trace.status).toBe('SUCCESS');
      expect(registry.forModel).not.toHaveBeenCalled();
      expect(toolCalling.complete).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 't1', taskType: 'RESPONDER', toolNames: ['search_products'], toolContext,
      }));
    });

    it('produces a PROVIDER_ERROR trace and empty response when the tool-calling call fails', async () => {
      const toolCalling = { complete: jest.fn().mockResolvedValue({ content: '', toolTrace: [], failed: true, hitMaxIterations: false }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage({ forModel: jest.fn() } as any, toolCalling as any);
      const ctx = buildCtx({ tools: ['search_products'], toolContext });

      await stage.execute(ctx);

      expect(ctx.result).toEqual({ response: '', confidence: null, blocked: false });
      expect(ctx.trace.status).toBe('PROVIDER_ERROR');
    });

    it('falls back to the original single-shot completion when tools are set but toolContext is missing', async () => {
      const registry = { forModel: jest.fn().mockReturnValue({ complete: jest.fn().mockResolvedValue({
        content: '{"response":"ok","confidence":80}', toolCalls: [], finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 }, provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 1,
      }) }) };
      const toolCalling = { complete: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage(registry as any, toolCalling as any);
      const ctx = buildCtx({ tools: ['search_products'] }); // no toolContext

      await stage.execute(ctx);

      expect(toolCalling.complete).not.toHaveBeenCalled();
      expect(ctx.result?.response).toBe('ok');
    });
  });
});
