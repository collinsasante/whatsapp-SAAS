import { EscalationStage } from './escalation.stage';
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

describe('EscalationStage', () => {
  let stage: EscalationStage;

  beforeEach(() => {
    stage = new EscalationStage();
  });

  it('escalates and replaces the response on an explicit human request', async () => {
    const ctx = buildCtx({
      customerMessage: 'Can I speak to a human please',
      result: { response: 'Sure, delivery is GHS 30.', confidence: 90, blocked: false },
      trace: { ...newTrace(), status: 'SUCCESS', confidence: 90 },
    });

    await stage.execute(ctx);

    expect(ctx.result?.shouldEscalate).toBe(true);
    expect(ctx.result?.response).toContain('team member');
    expect(ctx.trace.safetyFlags.humanEscalation).toBe(true);
    expect(ctx.trace.safetyFlags.escalationReason).toBe('explicit_request');
  });

  it('escalates on very low confidence even without an explicit request', async () => {
    const ctx = buildCtx({
      customerMessage: 'What is your policy on this weird edge case?',
      result: { response: 'I am not sure.', confidence: 10, blocked: false },
      trace: { ...newTrace(), status: 'SUCCESS', confidence: 10 },
    });

    await stage.execute(ctx);

    expect(ctx.result?.shouldEscalate).toBe(true);
    expect(ctx.trace.safetyFlags.escalationReason).toBe('low_confidence');
  });

  it('does not escalate a normal, confident response', async () => {
    const ctx = buildCtx({
      customerMessage: 'How much is delivery?',
      result: { response: 'Delivery is GHS 30.', confidence: 95, blocked: false },
      trace: { ...newTrace(), status: 'SUCCESS', confidence: 95 },
    });

    await stage.execute(ctx);

    expect(ctx.result?.shouldEscalate).toBeUndefined();
    expect(ctx.result?.response).toBe('Delivery is GHS 30.');
    expect(ctx.trace.safetyFlags.humanEscalation).toBeUndefined();
  });

  it('does nothing when the pipeline already short-circuited', async () => {
    const ctx = buildCtx({
      shortCircuit: true,
      customerMessage: 'Can I speak to a human',
      result: { response: 'blocked message', confidence: 100, blocked: true },
      trace: { ...newTrace(), status: 'BLOCKED' },
    });

    await stage.execute(ctx);

    expect(ctx.result?.shouldEscalate).toBeUndefined();
  });

  it('does nothing when there is no result yet', async () => {
    const ctx = buildCtx({ result: undefined });

    await expect(stage.execute(ctx)).resolves.not.toThrow();
  });

  it('records stage timing', async () => {
    const ctx = buildCtx({
      result: { response: 'ok', confidence: 90, blocked: false },
      trace: { ...newTrace(), status: 'SUCCESS', confidence: 90 },
    });

    await stage.execute(ctx);

    expect(ctx.trace.stageTimings.escalation).toBeGreaterThanOrEqual(0);
  });
});
