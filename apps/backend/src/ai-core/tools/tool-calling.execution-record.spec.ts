import { AiExecutionsService } from '../executions/ai-executions.service';
import { ToolCallingService } from './tool-calling.service';

/**
 * ToolCallingService and the real AiExecutionsService together, so what is stored (and what AI learning is told) for a
 * rejected final answer is checked end to end. Only the database, the provider and the credit ledger are fakes.
 */
function build(completion: Record<string, unknown>) {
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
  });
  return { prisma, credits, aiLearningTrigger, run };
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
