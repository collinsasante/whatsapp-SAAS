import { PolicyStage } from './policy.stage';
import { newTrace, PipelineContext } from '../pipeline.types';
import { HUMAN_HANDOFF_REPLY } from '../../prompts/escalation-messages.util';

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

  it('formats for WhatsApp by default (channelType absent)', async () => {
    const ctx = buildCtx({ result: { response: 'Your order is **confirmed**!', confidence: 90, blocked: false } });

    await stage.execute(ctx);

    expect(ctx.result?.response).toBe('Your order is *confirmed*!');
  });

  it('formats for WhatsApp explicitly when channelType is WHATSAPP', async () => {
    const ctx = buildCtx({
      input: { ...buildCtx().input, channelType: 'WHATSAPP' },
      result: { response: 'Your order is **confirmed**!', confidence: 90, blocked: false },
    });

    await stage.execute(ctx);

    expect(ctx.result?.response).toBe('Your order is *confirmed*!');
  });

  it('strips markdown for Messenger instead of converting it to WhatsApp syntax', async () => {
    const ctx = buildCtx({
      input: { ...buildCtx().input, channelType: 'FACEBOOK_MESSENGER' },
      result: { response: 'Your order is **confirmed**!', confidence: 90, blocked: false },
    });

    await stage.execute(ctx);

    expect(ctx.result?.response).toBe('Your order is confirmed!');
    expect(ctx.result?.response).not.toContain('*');
  });
});

describe('PolicyStage: unsupported follow-up promises become a real handoff', () => {
  const stage = new PolicyStage();
  const build = (response: string, toolTrace?: unknown, extra: Partial<NonNullable<PipelineContext['result']>> = {}): PipelineContext => {
    const trace = { ...newTrace(), status: 'SUCCESS' as const, confidence: 80, ...(toolTrace !== undefined && { toolTrace }) };
    return buildCtx({ result: { response, confidence: 80, blocked: false, ...extra }, trace });
  };

  it('replaces a promise nothing arranged with the real handoff reply and flags it', async () => {
    const ctx = build('Our team will get back to you about the price.');
    await stage.execute(ctx);
    expect(ctx.result).toMatchObject({ shouldEscalate: true, response: HUMAN_HANDOFF_REPLY });
    expect(ctx.trace.safetyFlags).toMatchObject({ unsupportedFollowUpPromise: true, humanEscalation: true, escalationReason: 'unsupported_follow_up_promise' });
  });

  it('keeps a promise that a successful create_internal_task arranged this turn', async () => {
    const ctx = build("I've passed this to our team and they will follow up with you.", [{ name: 'create_internal_task', result: { taskId: 'task-9' } }]);
    await stage.execute(ctx);
    expect(ctx.result?.shouldEscalate).toBeUndefined();
    expect(ctx.result?.response).toMatch(/will follow up/);
  });

  it('does not trust a task tool that errored', async () => {
    const ctx = build('Our team will follow up shortly.', [{ name: 'create_internal_task', result: { error: 'failed' } }]);
    await stage.execute(ctx);
    expect(ctx.result?.shouldEscalate).toBe(true);
  });

  it('leaves a direct factual answer completely alone', async () => {
    const ctx = build('Delivery to Accra is GHS 30 and takes one to two days.');
    await stage.execute(ctx);
    expect(ctx.result).toMatchObject({ response: 'Delivery to Accra is GHS 30 and takes one to two days.', confidence: 80 });
    expect(ctx.result?.shouldEscalate).toBeUndefined();
    expect(ctx.trace.safetyFlags.unsupportedFollowUpPromise).toBeUndefined();
  });

  it('leaves a plain "I do not have that" answer alone (no handoff is forced for an honest gap)', async () => {
    const ctx = build("I don't have the price for that one. If you'd like to talk to a team member, just ask.");
    await stage.execute(ctx);
    expect(ctx.result?.shouldEscalate).toBeUndefined();
  });

  it('works when the model reports no confidence (the tool-calling path)', async () => {
    const ctx = buildCtx({ result: { response: 'Someone will get back to you.', confidence: null, blocked: false }, trace: { ...newTrace(), status: 'SUCCESS' } });
    await stage.execute(ctx);
    expect(ctx.result?.shouldEscalate).toBe(true);
  });

  it('does not touch a reply that is already escalating', async () => {
    const ctx = build(HUMAN_HANDOFF_REPLY, undefined, { shouldEscalate: true });
    await stage.execute(ctx);
    expect(ctx.trace.safetyFlags.unsupportedFollowUpPromise).toBeUndefined();
  });

  it('a short-circuited run (injection refusal, outage) is not rewritten', async () => {
    const ctx = build('Our team will follow up.');
    ctx.shortCircuit = true;
    await stage.execute(ctx);
    expect(ctx.result?.response).toBe('Our team will follow up.');
  });
});
