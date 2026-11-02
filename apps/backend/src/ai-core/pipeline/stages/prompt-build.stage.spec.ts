import { PromptBuildStage } from './prompt-build.stage';
import { newTrace, PipelineContext } from '../pipeline.types';
import { HandoffOutcome } from '../../prompts/handoff-context';

function buildCtx(handoffOutcome?: HandoffOutcome): PipelineContext {
  return {
    input: { tenantId: 't1', agentId: 'a1', conversationId: 'c1', customerMessage: 'hi', taskType: 'RESPONDER', ...(handoffOutcome && { handoffOutcome }) },
    businessName: 'Acme', personality: 'Warm.', systemInstructions: '', modelKey: 'deepseek-v4-flash', maxResponseTokens: 400,
    customerMessage: 'hi', historyMessages: [], knowledgeContext: '', shortCircuit: false, trace: newTrace(),
  };
}

const prompts = { getActiveVersion: jest.fn().mockResolvedValue({ id: 'v1', body: 'You are the assistant for {{business_name}}. PERSONALITY: {{personality}}' }) };

describe('PromptBuildStage: handoff context and security wording', () => {
  const stage = new PromptBuildStage(prompts as never);

  it('adds no handoff block when no handoff was performed', async () => {
    const ctx = buildCtx();
    await stage.execute(ctx);
    expect(ctx.renderedSystemPrompt).not.toMatch(/HANDOFF STATUS/);
  });

  it('puts the verified outcome in the prompt, after the safety block', async () => {
    const ok = buildCtx('requested');
    await stage.execute(ok);
    expect(ok.renderedSystemPrompt).toMatch(/HANDOFF STATUS[\s\S]*Do NOT offer, suggest or ask whether they would like to speak with a person/);
    expect(ok.renderedSystemPrompt!.indexOf('HANDOFF STATUS')).toBeGreaterThan(ok.renderedSystemPrompt!.indexOf('ABSOLUTE SAFETY GUARDRAILS'));

    const failed = buildCtx('failed');
    await stage.execute(failed);
    expect(failed.renderedSystemPrompt).toMatch(/Do NOT say or imply that anyone has been notified/);
  });

  it('tells the model to decline an override attempt in its own voice, not to recite a sentence', async () => {
    const ctx = buildCtx();
    await stage.execute(ctx);
    expect(ctx.renderedSystemPrompt).toMatch(/decline briefly in your own voice and steer back/);
    expect(ctx.renderedSystemPrompt).not.toMatch(/respond ONLY with:/i);
  });
});
