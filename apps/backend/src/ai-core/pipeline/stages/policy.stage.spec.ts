import { PolicyStage } from './policy.stage';
import { newTrace, PipelineContext } from '../pipeline.types';

function buildCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    input: { tenantId: 't1', agentId: 'a1', conversationId: 'c1', customerMessage: 'hi', taskType: 'RESPONDER' },
    businessName: 'Acme',
    personality: '',
    systemInstructions: '',
    modelKey: 'deepseek-v4-flash',
    maxResponseTokens: 400,
    customerMessage: 'hi',
    historyMessages: [],
    knowledgeContext: '',
    shortCircuit: false,
    trace: newTrace(),
    ...overrides,
  };
}

describe('PolicyStage', () => {
  let stage: PolicyStage;

  beforeEach(() => {
    stage = new PolicyStage();
  });

  it.each([
    'Our team will follow up shortly.',
    'A team member will assist you soon.',
    "That's a great question! Let me check.",
  ])('caps confidence to at most 40 when the response contains a fallback signal: "%s"', async (response) => {
    const ctx = buildCtx({ result: { response, confidence: 85, blocked: false }, trace: { ...newTrace(), status: 'SUCCESS', confidence: 85 } });

    await stage.execute(ctx);

    expect(ctx.result?.confidence).toBe(40);
    expect(ctx.trace.confidence).toBe(40);
    expect(ctx.trace.safetyFlags.fallbackCapped).toBe(true);
  });

  it('does not lower confidence that is already below the cap', async () => {
    const ctx = buildCtx({ result: { response: 'Our team will follow up shortly.', confidence: 20, blocked: false }, trace: { ...newTrace(), status: 'SUCCESS', confidence: 20 } });

    await stage.execute(ctx);

    expect(ctx.result?.confidence).toBe(20);
  });

  it('leaves confidence untouched for a normal, confident response', async () => {
    const ctx = buildCtx({ result: { response: 'Delivery to Accra is GHS 30.', confidence: 95, blocked: false }, trace: { ...newTrace(), status: 'SUCCESS', confidence: 95 } });

    await stage.execute(ctx);

    expect(ctx.result?.confidence).toBe(95);
    expect(ctx.trace.safetyFlags.fallbackCapped).toBeUndefined();
  });

  it('flags empty output and downgrades status from SUCCESS to EMPTY', async () => {
    const ctx = buildCtx({ result: { response: '', confidence: null, blocked: false }, trace: { ...newTrace(), status: 'SUCCESS' } });

    await stage.execute(ctx);

    expect(ctx.trace.status).toBe('EMPTY');
    expect(ctx.trace.safetyFlags.emptyOutput).toBe(true);
  });

  it('does nothing when the pipeline already short-circuited (e.g. a blocked message)', async () => {
    const ctx = buildCtx({
      shortCircuit: true,
      result: { response: 'blocked message', confidence: 100, blocked: true },
      trace: { ...newTrace(), status: 'BLOCKED' },
    });

    await stage.execute(ctx);

    expect(ctx.trace.status).toBe('BLOCKED');
    expect(ctx.trace.safetyFlags.fallbackCapped).toBeUndefined();
  });

  it('does nothing when there is no result yet', async () => {
    const ctx = buildCtx({ result: undefined });

    await expect(stage.execute(ctx)).resolves.not.toThrow();
  });
});
