import { AiExecutionsService } from '../executions/ai-executions.service';
import { ReplyFormat, ToolCallingService } from './tool-calling.service';
import { GenerationStage } from '../pipeline/stages/generation.stage';
import { newTrace, PipelineContext } from '../pipeline/pipeline.types';
import { DEFAULT_MODEL_KEY } from '../models/model-catalog';
import { PROVIDER_FAILURE_FALLBACK_TEXT } from '../prompts/escalation-messages.util';

/**
 * ToolCallingService and the real AiExecutionsService together, so what is stored (and what AI learning is told) for a
 * rejected final answer is checked end to end. Only the database, the provider and the credit ledger are fakes.
 */
function build(completion: Record<string, unknown>, replyFormat?: ReplyFormat) {
  const prisma = {
    aiExecution: { create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'exec-1', ...data })) },
  };
  const credits = { linkReservationsToExecution: jest.fn().mockResolvedValue(undefined), settleForExecution: jest.fn().mockResolvedValue(undefined) };
  const pricing = { getCreditsForUsage: jest.fn().mockResolvedValue(3) };
  const aiLearningTrigger = { maybeEnqueue: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executions = new AiExecutionsService(prisma as any, credits as any, pricing as any, aiLearningTrigger as any);
  const meteredProvider = { complete: jest.fn().mockResolvedValue({ result: { toolCalls: [], usage: { inputTokens: 100, outputTokens: 40 }, provider: 'deepseek', model: 'deepseek-v4-flash', latencyMs: 5, ...completion }, reservationId: 'reservation-1' }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ToolCallingService({ forModel: jest.fn().mockReturnValue({}) } as any, { getDefs: jest.fn().mockReturnValue([]), execute: jest.fn() } as any, executions as any, meteredProvider as any);
  const run = () => service.complete({
    tenantId: 't1', taskType: 'RESPONDER', conversationId: 'c1', systemPrompt: 's', historyMessages: [], userMessage: 'hi',
    toolNames: [], toolContext: { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233555000111' },
    ...(replyFormat && { replyFormat }),
  });
  return { prisma, credits, aiLearningTrigger, meteredProvider, service, run };
}

describe('the execution stored for a final answer', () => {
  it.each([
    ['blank', { content: '', finishReason: 'stop' }, 'empty'],
    ['whitespace-only', { content: '  \n ', finishReason: 'stop' }, 'empty'],
    ['malformed', { content: '{"response": "Hi', finishReason: 'stop' }, 'malformed'],
    ['error-like', { content: 'TypeError: Cannot read properties of undefined', finishReason: 'stop' }, 'internal_error'],
    ['truncated', { content: 'We open at nine and', finishReason: 'length' }, 'truncated'],
  ])('a %s answer is stored once as PROVIDER_ERROR / parse_error and AI learning is told it failed', async (_name, completion, reason) => {
    const t = build(completion);

    await t.run();

    expect(t.prisma.aiExecution.create).toHaveBeenCalledTimes(1);
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      status: 'PROVIDER_ERROR', errorCode: 'parse_error', errorMessage: `Model output rejected: ${reason}`, inputTokens: 100, outputTokens: 40,
    }));
    expect(t.aiLearningTrigger.maybeEnqueue).toHaveBeenCalledTimes(1);
    expect(t.aiLearningTrigger.maybeEnqueue).toHaveBeenCalledWith(expect.objectContaining({ aiExecutionId: 'exec-1', status: 'PROVIDER_ERROR' }));
    // Billing is untouched: the reservation is linked exactly as for a good answer, and nothing is charged here.
    expect(t.credits.linkReservationsToExecution).toHaveBeenCalledWith('t1', 'exec-1', ['reservation-1']);
    expect(t.credits.settleForExecution).not.toHaveBeenCalled();
  });

  it('a valid answer is stored once as SUCCESS and AI learning is told it succeeded', async () => {
    const t = build({ content: 'We open at nine.', finishReason: 'stop' });

    await t.run();

    expect(t.prisma.aiExecution.create).toHaveBeenCalledTimes(1);
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ status: 'SUCCESS' }));
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data.errorCode).toBeUndefined();
    expect(t.aiLearningTrigger.maybeEnqueue).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
    expect(t.credits.linkReservationsToExecution).toHaveBeenCalledWith('t1', 'exec-1', ['reservation-1']);
  });
});

// The responder prompt asks for {"response","confidence"} on every path. On staging (2026-11-01) the tool-calling path judged a
// reply in exactly that shape as machine output, so two of four test replies were refused and the customer got the fallback.
describe('a structured {"response","confidence"} final answer', () => {
  const observed = '{"response":"We open on Saturday from 8:00 to 16:00.","confidence":92}';

  it('is refused by a plain-format run (what Commerce relies on, unchanged)', async () => {
    const t = build({ content: observed, finishReason: 'stop' });

    const result = await t.run();

    expect(result.outputProblem).toBe('malformed');
    expect(result.content).toBe(observed);
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ status: 'PROVIDER_ERROR', errorMessage: 'Model output rejected: malformed' }));
  });

  it('is accepted by a structured run: the response is unwrapped, the confidence kept, and the one execution is SUCCESS', async () => {
    const t = build({ content: observed, finishReason: 'stop' }, 'structured');

    const result = await t.run();

    expect(result.outputProblem).toBeUndefined();
    expect(result.content).toBe('We open on Saturday from 8:00 to 16:00.');
    expect(result.confidence).toBe(92);
    expect(t.prisma.aiExecution.create).toHaveBeenCalledTimes(1);
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ status: 'SUCCESS', inputTokens: 100, outputTokens: 40 }));
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data.errorCode).toBeUndefined();
    expect(t.aiLearningTrigger.maybeEnqueue).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
    expect(t.credits.linkReservationsToExecution).toHaveBeenCalledWith('t1', 'exec-1', ['reservation-1']);
  });

  it.each([
    ['a fenced block', '```json\n{"response":"We open at nine.","confidence":80}\n```', 'We open at nine.', 80],
    ['one object after a short preamble', 'Sure! {"response":"We open at nine.","confidence":80}', 'We open at nine.', 80],
    ['an object without a confidence', '{"response":"We open at nine."}', 'We open at nine.', null],
    ['a broken tail with the response string closed', '{"response":"We open at nine.","confidence":80', 'We open at nine.', 80],
  ])('accepts %s', async (_name, content, response, confidence) => {
    const t = build({ content, finishReason: 'stop' }, 'structured');

    const result = await t.run();

    expect(result.outputProblem).toBeUndefined();
    expect(result.content).toBe(response);
    expect(result.confidence).toBe(confidence);
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data.status).toBe('SUCCESS');
  });

  it('still accepts clean prose when the model ignores the format, with no confidence', async () => {
    const t = build({ content: 'We open on Saturday from 8:00 to 16:00.', finishReason: 'stop' }, 'structured');

    const result = await t.run();

    expect(result.outputProblem).toBeUndefined();
    expect(result.content).toBe('We open on Saturday from 8:00 to 16:00.');
    expect(result.confidence).toBeNull();
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data.status).toBe('SUCCESS');
  });

  it.each([
    ['blank', '', 'stop', 'empty'],
    ['whitespace-only', '  \n ', 'stop', 'empty'],
    ['an unclosed response string', '{"response": "Hi', 'stop', 'truncated'],
    ['a valid object cut off at the token limit', '{"response":"We open at nine.","confidence":80}', 'length', 'truncated'],
    ['two reply objects', '{"response":"A","confidence":50} {"response":"B","confidence":60}', 'stop', 'malformed'],
    ['a JSON array', '[{"response":"A"}]', 'stop', 'malformed'],
    ['an error body', '{"error":{"message":"rate limited"}}', 'stop', 'internal_error'],
    ['error-like prose', 'TypeError: Cannot read properties of undefined', 'stop', 'internal_error'],
    ['a reply whose response is itself JSON', '{"response":"{\\"response\\":\\"Hi\\"}","confidence":50}', 'stop', 'malformed'],
  ])('refuses %s as %s, stores one PROVIDER_ERROR, and never hands the text on as a reply', async (_name, content, finishReason, reason) => {
    const t = build({ content, finishReason }, 'structured');

    const result = await t.run();

    expect(result.outputProblem).toBe(reason);
    expect(result.confidence).toBeUndefined();
    expect(t.prisma.aiExecution.create).toHaveBeenCalledTimes(1);
    expect(t.prisma.aiExecution.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      status: 'PROVIDER_ERROR', errorCode: 'parse_error', errorMessage: `Model output rejected: ${reason}`,
    }));
    expect(t.credits.settleForExecution).not.toHaveBeenCalled();
  });

  describe('through the v2 GenerationStage', () => {
    const toolContext = { tenantId: 't1', conversationId: 'c1', contactId: 'ct1', customerPhone: '+233555000111' };
    const ctx = (): PipelineContext => ({
      input: { tenantId: 't1', agentId: 'a1', conversationId: 'c1', customerMessage: 'What time do you open on Saturday?', taskType: 'TEST', simulated: true },
      businessName: 'Fernhill Bakery', personality: '', systemInstructions: '', modelKey: DEFAULT_MODEL_KEY, maxResponseTokens: 400,
      customerMessage: 'What time do you open on Saturday?', historyMessages: [], knowledgeContext: '', renderedSystemPrompt: 'You are a bakery assistant.',
      shortCircuit: false, trace: newTrace(), tools: ['remember_conversation_facts'], toolContext,
    });
    const stageFor = (t: ReturnType<typeof build>) => new GenerationStage({ forModel: jest.fn() } as never, t.service as never, { mergeState: jest.fn().mockResolvedValue(undefined) } as never, { complete: jest.fn() } as never);

    it('the reply shape rejected on staging now reaches the customer as plain text, with its confidence, as SUCCESS', async () => {
      const t = build({ content: observed, finishReason: 'stop' });
      const c = ctx();

      await stageFor(t).execute(c);

      expect(c.result).toEqual(expect.objectContaining({ response: 'We open on Saturday from 8:00 to 16:00.', confidence: 92, blocked: false }));
      expect(c.result?.response).not.toContain('{');
      expect(c.result?.shouldEscalate).toBeUndefined();
      expect(c.trace.status).toBe('SUCCESS');
      expect(c.trace.confidence).toBe(92);
      expect(c.trace.alreadyRecorded).toBe(true);
      expect(t.prisma.aiExecution.create).toHaveBeenCalledTimes(1);
    });

    it('prose is sent as is with no confidence', async () => {
      const t = build({ content: 'We open on Saturday from 8:00 to 16:00.', finishReason: 'stop' });
      const c = ctx();

      await stageFor(t).execute(c);

      expect(c.result).toEqual(expect.objectContaining({ response: 'We open on Saturday from 8:00 to 16:00.', confidence: null }));
      expect(c.trace.status).toBe('SUCCESS');
    });

    it.each(['', '{"response": "Hi', '{"error":"x"}'])('broken output (%j) becomes the fallback and a handoff, and nothing broken is sent', async (content) => {
      const t = build({ content, finishReason: 'stop' });
      const c = ctx();

      await stageFor(t).execute(c);

      expect(c.result).toEqual({ response: PROVIDER_FAILURE_FALLBACK_TEXT, confidence: null, blocked: false, shouldEscalate: true });
      expect(c.trace.status).toBe('PROVIDER_ERROR');
      expect(c.trace.errorCode).toBe('parse_error');
    });
  });
});
