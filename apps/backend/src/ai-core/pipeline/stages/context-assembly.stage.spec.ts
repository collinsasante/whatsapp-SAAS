import { HISTORY_ROW_FILTER } from '../../context/history-scope.util';
import { HISTORY_FETCH_BUFFER } from '../../../ai-core/context/history-select.util';
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
  let prisma: { tenantSettings: { findUnique: jest.Mock }; message: { findMany: jest.Mock }; conversation: { findFirst: jest.Mock } };
  let conversationState: { getState: jest.Mock };
  let knowledgeSource: jest.Mocked<KnowledgeContextSource>;
  let stage: ContextAssemblyStage;

  beforeEach(() => {
    prisma = { tenantSettings: { findUnique: jest.fn() }, message: { findMany: jest.fn() }, conversation: { findFirst: jest.fn().mockResolvedValue(null) } };
    conversationState = { getState: jest.fn().mockResolvedValue(null) };
    knowledgeSource = { getContext: jest.fn().mockResolvedValue('') };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stage = new ContextAssemblyStage(prisma as any, conversationState as any, knowledgeSource);
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

    expect(knowledgeSource.getContext).toHaveBeenCalledWith('t1', 'I selected option 1: Delivery info', expect.any(Array));
    expect(ctx.knowledgeContext).toContain('We ship in 2 days.');
  });

  it('records stage timing', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    prisma.message.findMany.mockResolvedValue([]);
    const ctx = buildCtx('hi');

    await stage.execute(ctx);

    expect(ctx.trace.stageTimings.context_assembly).toBeGreaterThanOrEqual(0);
  });

  it('queries only the current conversation, scoped to the tenant, with the original 12-message limit', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    prisma.message.findMany.mockResolvedValue([]);

    await stage.execute(buildCtx('hi'));

    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 't1', conversationId: 'c1', ...HISTORY_ROW_FILTER },
      take: 12 + HISTORY_FETCH_BUFFER,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('does NOT widen to contact scope even when the conversation has a contactId (the 200-message/contact expansion is split out)', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    prisma.conversation.findFirst.mockResolvedValue({ adSourceId: null, adHeadline: null, adImageUrl: null, contactId: 'contact-42' });
    prisma.message.findMany.mockResolvedValue([]);

    await stage.execute(buildCtx('hi'));

    const call = prisma.message.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('conversation');
    expect(call.take).toBe(12 + HISTORY_FETCH_BUFFER);
  });

  it('is tenant-scoped: the query can only match rows of the calling tenant', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    prisma.message.findMany.mockResolvedValue([]);
    const ctx = buildCtx('hi');
    ctx.input.conversationId = 'conv-owned-by-tenant-2';

    await stage.execute(ctx);

    expect(prisma.message.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ tenantId: 't1', conversationId: 'conv-owned-by-tenant-2' }));
  });

  it('runs no message query and yields empty history when the conversation id is blank (never an absent filter)', async () => {
    prisma.tenantSettings.findUnique.mockResolvedValue({ businessName: 'Acme' });
    const ctx = buildCtx('hi');
    ctx.input.conversationId = '';

    await stage.execute(ctx);

    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(ctx.historyMessages).toEqual([]);
  });
});
