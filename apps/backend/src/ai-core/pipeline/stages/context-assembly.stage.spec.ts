import { ContextAssemblyStage } from './context-assembly.stage';
import { newTrace, PipelineContext } from '../pipeline.types';
import { KnowledgeContextSource } from '../knowledge-context.source';

function buildCtx(customerMessage: string): PipelineContext {
  return {
    input: { tenantId: 't1', agentId: 'a1', conversationId: 'c1', customerMessage, taskType: 'RESPONDER' },
    businessName: '',
    personality: '',
    systemInstructions: '',
    modelKey: 'deepseek-v4-flash',
    maxResponseTokens: 400,
    customerMessage,
    historyMessages: [],
    knowledgeContext: '',
    shortCircuit: false,
    trace: newTrace(),
  };
}

describe('ContextAssemblyStage', () => {
  let prisma: { tenantSettings: { findUnique: jest.Mock }; message: { findMany: jest.Mock } };
  let knowledgeSource: jest.Mocked<KnowledgeContextSource>;
  let stage: ContextAssemblyStage;

  beforeEach(() => {
    prisma = { tenantSettings: { findUnique: jest.fn() }, message: { findMany: jest.fn() } };
    knowledgeSource = { getContext: jest.fn().mockResolvedValue('') };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stage = new ContextAssemblyStage(prisma as any, knowledgeSource);
  });

  it('sets businessName from TenantSettings, falling back to "our business"', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue(null);
    prisma.message.findMany.mockResolvedValue([]);
    const ctx = buildCtx('hi');

    await stage.execute(ctx);

    expect(ctx.businessName).toBe('our business');
  });

  it('reverses history into chronological order and drops the newest (current) message', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    // findMany returns desc order (newest first): current msg, then two prior turns
    prisma.message.findMany.mockResolvedValue([
      { direction: 'INBOUND', content: 'current message' },
      { direction: 'OUTBOUND', content: 'sure, one moment' },
      { direction: 'INBOUND', content: 'earlier question' },
    ]);
    const ctx = buildCtx('current message');

    await stage.execute(ctx);

    expect(ctx.historyMessages).toEqual([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'sure, one moment' },
    ]);
  });

  it('expands a bare digit reply into the full menu option text', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    prisma.message.findMany.mockResolvedValue([
      { direction: 'INBOUND', content: '2' },
      { direction: 'OUTBOUND', content: '1) Blue Shirt\n2) Red Shirt\n3) Green Shirt' },
    ]);
    const ctx = buildCtx('2');

    await stage.execute(ctx);

    expect(ctx.customerMessage).toBe('I selected option 2: Red Shirt');
  });

  it('does not expand a digit reply when the last outbound message is not a numbered menu', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    prisma.message.findMany.mockResolvedValue([
      { direction: 'INBOUND', content: '2' },
      { direction: 'OUTBOUND', content: 'Thanks for reaching out!' },
    ]);
    const ctx = buildCtx('2');

    await stage.execute(ctx);

    expect(ctx.customerMessage).toBe('2');
  });

  it('queries KB relevance using the (possibly menu-expanded) final customer message', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    prisma.message.findMany.mockResolvedValue([
      { direction: 'INBOUND', content: '1' },
      { direction: 'OUTBOUND', content: '1) Delivery info\n2) Returns' },
    ]);
    knowledgeSource.getContext.mockResolvedValue('\n\nKNOWLEDGE BASE:\n## Delivery\nWe ship in 2 days.');
    const ctx = buildCtx('1');

    await stage.execute(ctx);

    expect(knowledgeSource.getContext).toHaveBeenCalledWith('t1', 'I selected option 1: Delivery info');
    expect(ctx.knowledgeContext).toContain('We ship in 2 days.');
  });

  it('records stage timing', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    prisma.message.findMany.mockResolvedValue([]);
    const ctx = buildCtx('hi');

    await stage.execute(ctx);

    expect(ctx.trace.stageTimings.context_assembly).toBeGreaterThanOrEqual(0);
  });
});
