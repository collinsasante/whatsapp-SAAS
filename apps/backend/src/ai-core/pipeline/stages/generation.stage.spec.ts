import { GenerationStage } from './generation.stage';
import { newTrace, PipelineContext } from '../pipeline.types';
import { DEFAULT_MODEL_KEY } from '../../models/model-catalog';
import { PROVIDER_FAILURE_FALLBACK_TEXT } from '../../prompts/escalation-messages.util';

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
      const meteredProvider = { complete: jest.fn(async (selectedProvider: { complete: (request: unknown) => Promise<unknown> }, _tenantId: string, _taskType: string, request: unknown) => ({ result: await selectedProvider.complete(request), reservationId: 'reservation-1' })) };
      const conversationState = { mergeState: jest.fn().mockResolvedValue(undefined) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage(registry as any, toolCalling as any, conversationState as any, meteredProvider as any);
      const ctx = buildCtx();

      await stage.execute(ctx);

      expect(ctx.result).toEqual({ response: 'Delivery is GHS 30.', confidence: 90, blocked: false });
      expect(ctx.trace.reservationIds).toEqual(['reservation-1']);
      expect(toolCalling.complete).not.toHaveBeenCalled();
    });

    it('rejects a single-shot completion the provider stopped at the token limit, even though it parses, as the fallback and a handoff', async () => {
      const complete = jest.fn().mockResolvedValue({
        content: '{"response":"Delivery is GHS 30 and takes","confidence":90}', toolCalls: [], finishReason: 'length',
        usage: { inputTokens: 10, outputTokens: 400 }, provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 5,
      });
      const meteredProvider = { complete: jest.fn(async (selectedProvider: { complete: (request: unknown) => Promise<unknown> }, _t: string, _k: string, request: unknown) => ({ result: await selectedProvider.complete(request), reservationId: 'reservation-1' })) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage({ forModel: jest.fn().mockReturnValue({ complete }) } as any, { complete: jest.fn() } as any, { mergeState: jest.fn() } as any, meteredProvider as any);
      const ctx = buildCtx();

      await stage.execute(ctx);

      expect(ctx.result).toEqual({ response: PROVIDER_FAILURE_FALLBACK_TEXT, confidence: null, blocked: false, shouldEscalate: true });
      expect(ctx.trace).toEqual(expect.objectContaining({ status: 'PROVIDER_ERROR', errorCode: 'parse_error', errorMessage: 'Model output rejected: truncated', inputTokens: 10, outputTokens: 400, reservationIds: ['reservation-1'] }));
      expect(ctx.trace.alreadyRecorded).toBeUndefined(); // this path is recorded once, by the pipeline
    });

    it('still accepts a single-shot completion that finished normally', async () => {
      const complete = jest.fn().mockResolvedValue({
        content: '{"response":"Delivery is GHS 30.","confidence":90}', toolCalls: [], finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 12 }, provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 5,
      });
      const meteredProvider = { complete: jest.fn(async (selectedProvider: { complete: (request: unknown) => Promise<unknown> }, _t: string, _k: string, request: unknown) => ({ result: await selectedProvider.complete(request), reservationId: 'reservation-1' })) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage({ forModel: jest.fn().mockReturnValue({ complete }) } as any, { complete: jest.fn() } as any, { mergeState: jest.fn() } as any, meteredProvider as any);
      const ctx = buildCtx();

      await stage.execute(ctx);

      expect(ctx.result?.response).toBe('Delivery is GHS 30.');
      expect(ctx.trace.status).toBe('SUCCESS');
    });
  });

  describe('with tools (Verz-AI unification, Phase A)', () => {
    const toolContext = { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233555000111' };
    const conversationState = { mergeState: jest.fn().mockResolvedValue(undefined) };

    it('delegates to ToolCallingService and uses its plain-text result as the response', async () => {
      const registry = { forModel: jest.fn() };
      const toolCalling = { complete: jest.fn().mockResolvedValue({ content: 'We have that in stock.', toolTrace: [], failed: false, hitMaxIterations: false }) };
      const meteredProvider = { complete: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage(registry as any, toolCalling as any, conversationState as any, meteredProvider as any);
      const ctx = buildCtx({ tools: ['search_products'], toolContext });

      await stage.execute(ctx);

      expect(ctx.result).toEqual({ response: 'We have that in stock.', confidence: null, blocked: false });
      expect(ctx.trace.status).toBe('SUCCESS');
      expect(registry.forModel).not.toHaveBeenCalled();
      expect(toolCalling.complete).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 't1', taskType: 'RESPONDER', toolNames: ['search_products'], toolContext,
      }));
    });

    it('passes a simulated run through to the tool-calling run (as the unmetered TEST task), and leaves a real run untagged', async () => {
      const toolCalling = { complete: jest.fn().mockResolvedValue({ content: 'We have that in stock.', toolTrace: [], failed: false, hitMaxIterations: false }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage({ forModel: jest.fn() } as any, toolCalling as any, conversationState as any, { complete: jest.fn() } as any);

      await stage.execute(buildCtx({ tools: ['search_products'], toolContext, input: { tenantId: 't1', agentId: 'a1', conversationId: 'c1', customerMessage: 'hi', taskType: 'TEST', simulated: true } }));
      expect(toolCalling.complete).toHaveBeenLastCalledWith(expect.objectContaining({ taskType: 'TEST', simulated: true }));

      await stage.execute(buildCtx({ tools: ['search_products'], toolContext }));
      expect(toolCalling.complete.mock.calls[1][0].simulated).toBeUndefined();
      expect(toolCalling.complete.mock.calls[1][0].taskType).toBe('RESPONDER');
    });

    it('produces a PROVIDER_ERROR trace and a real fallback + escalation when the tool-calling call fails, instead of empty silence', async () => {
      const toolCalling = { complete: jest.fn().mockResolvedValue({ content: '', toolTrace: [], failed: true, hitMaxIterations: false }) };
      const meteredProvider = { complete: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage({ forModel: jest.fn() } as any, toolCalling as any, conversationState as any, meteredProvider as any);
      const ctx = buildCtx({ tools: ['search_products'], toolContext });

      await stage.execute(ctx);

      expect(ctx.result?.response).not.toBe('');
      expect(ctx.result?.shouldEscalate).toBe(true);
      expect(ctx.result?.confidence).toBeNull();
      expect(ctx.result?.blocked).toBe(false);
      expect(ctx.trace.status).toBe('PROVIDER_ERROR');
    });

    it.each(['empty', 'truncated', 'malformed', 'internal_error'] as const)('a final answer ToolCallingService rejected (%s) becomes the fallback and a handoff, and is not recorded a second time', async (outputProblem) => {
      const toolCalling = { complete: jest.fn().mockResolvedValue({ content: 'half an ans', toolTrace: [], failed: false, hitMaxIterations: false, executionId: 'exec-1', outputProblem }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage({ forModel: jest.fn() } as any, toolCalling as any, conversationState as any, { complete: jest.fn() } as any);
      const ctx = buildCtx({ tools: ['search_products'], toolContext });

      await stage.execute(ctx);

      expect(ctx.result).toEqual({ response: PROVIDER_FAILURE_FALLBACK_TEXT, confidence: null, blocked: false, shouldEscalate: true });
      expect(ctx.result?.response).not.toContain('half an ans');
      expect(ctx.trace.status).toBe('PROVIDER_ERROR');
      expect(ctx.trace.errorCode).toBe('parse_error');
      expect(ctx.trace.errorMessage).toBe(`Model output rejected: ${outputProblem}`);
      expect(ctx.trace.alreadyRecorded).toBe(true); // ToolCallingService wrote the one execution; the pipeline must not write another
    });

    it('a valid final answer stays SUCCESS and is used as is', async () => {
      const toolCalling = { complete: jest.fn().mockResolvedValue({ content: 'We have that in stock.', toolTrace: [], failed: false, hitMaxIterations: false, executionId: 'exec-1' }) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage({ forModel: jest.fn() } as any, toolCalling as any, conversationState as any, { complete: jest.fn() } as any);
      const ctx = buildCtx({ tools: ['search_products'], toolContext });

      await stage.execute(ctx);

      expect(ctx.result).toEqual({ response: 'We have that in stock.', confidence: null, blocked: false });
      expect(ctx.trace.status).toBe('SUCCESS');
      expect(ctx.trace.errorCode).toBeUndefined();
    });

    it('falls back to the original single-shot completion when tools are set but toolContext is missing', async () => {
      const registry = { forModel: jest.fn().mockReturnValue({ complete: jest.fn().mockResolvedValue({
        content: '{"response":"ok","confidence":80}', toolCalls: [], finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 }, provider: 'deepseek', model: DEFAULT_MODEL_KEY, latencyMs: 1,
      }) }) };
      const toolCalling = { complete: jest.fn() };
      const meteredProvider = { complete: jest.fn(async (selectedProvider: { complete: (request: unknown) => Promise<unknown> }, _tenantId: string, _taskType: string, request: unknown) => ({ result: await selectedProvider.complete(request), reservationId: 'reservation-1' })) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stage = new GenerationStage(registry as any, toolCalling as any, conversationState as any, meteredProvider as any);
      const ctx = buildCtx({ tools: ['search_products'] }); // no toolContext

      await stage.execute(ctx);

      expect(toolCalling.complete).not.toHaveBeenCalled();
      expect(ctx.result?.response).toBe('ok');
    });
  });
});
