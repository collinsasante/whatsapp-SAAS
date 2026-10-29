import { KnowledgeBaseService } from './knowledge-base.service';

type Msg = { direction: 'INBOUND' | 'OUTBOUND'; content: string; sender?: { isAiAgent: boolean; name?: string } | null };
const conv = (name: string | null, msgs: Msg[]) => ({ contact: { name }, messages: msgs.map((m) => ({ type: 'TEXT', deletedForEveryone: false, ...m })) });

function build(conversations: unknown[], existing: Array<{ title: string; content: string }> = []) {
  const prisma = {
    conversation: { findMany: jest.fn().mockResolvedValue(conversations) },
    knowledgeBaseArticle: { findMany: jest.fn().mockResolvedValue(existing), create: jest.fn().mockResolvedValue({}) },
  };
  const ai = { complete: jest.fn() };
  return { service: new KnowledgeBaseService(prisma as never, ai as never), prisma, ai };
}
const reply = (articles: unknown) => ({ failed: false, content: JSON.stringify(articles) });

describe('KnowledgeBaseService.learnFromConversations (D-learning-safety)', () => {
  const original = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'unit-test-placeholder'; }); // the provider call is mocked; nothing leaves the process
  afterEach(() => { process.env.DEEPSEEK_API_KEY = original; });

  const human = { isAiAgent: false, name: 'Esi Owusu' };
  const ai = { isAiAgent: true };
  const goodConv = conv('Kofi Mensah', [
    { direction: 'INBOUND', content: 'Hi, how much is delivery to Kumasi? call me on 0241234567' },
    { direction: 'OUTBOUND', content: 'Hello Kofi, delivery to Kumasi is GHS 45. Mail esi@shop.com if you need an invoice.', sender: human },
  ]);

  it('sends the provider only redacted text: phone, email and the names of the contact and the agent never leave', async () => {
    const { service, ai: provider } = build([goodConv]);
    provider.complete.mockResolvedValue(reply([]));
    await service.learnFromConversations('t1');
    const sent = JSON.stringify(provider.complete.mock.calls[0][0].messages);
    expect(sent).not.toMatch(/0241234567|esi@shop\.com|Kofi|Mensah|Esi|Owusu/);
    expect(sent).toMatch(/\[PHONE\]/);
    expect(sent).toMatch(/\[EMAIL\]/);
    expect(sent).toMatch(/\[NAME\]/);
    expect(sent).toMatch(/delivery to Kumasi is GHS 45/); // the useful content survives
  });

  it('stores what the model generated as INACTIVE, labelled as learned, so nothing reaches customers until an admin reviews it', async () => {
    const { service, ai: provider, prisma } = build([goodConv]);
    provider.complete.mockResolvedValue(reply([{ title: 'Delivery to Kumasi', content: 'Delivery to Kumasi costs GHS 45.' }]));
    await expect(service.learnFromConversations('t1')).resolves.toEqual({ created: 1 });
    expect(prisma.knowledgeBaseArticle.create).toHaveBeenCalledWith({ data: { tenantId: 't1', title: 'Delivery to Kumasi', content: 'Delivery to Kumasi costs GHS 45.', source: 'learned', isActive: false } });
  });

  it('redacts personal data the model repeats in a generated article', async () => {
    const { service, ai: provider, prisma } = build([goodConv]);
    provider.complete.mockResolvedValue(reply([{ title: 'Invoices', content: 'Email billing@shop.com or call 0551234567 for an invoice.' }]));
    await service.learnFromConversations('t1');
    const data = prisma.knowledgeBaseArticle.create.mock.calls[0][0].data;
    expect(data.content).toBe('Email [EMAIL] or call [PHONE] for an invoice.');
    expect(data.isActive).toBe(false);
  });

  it('never uses the AI agent\'s own replies as answers (they are not ground truth)', async () => {
    const aiOnly = conv('Ama', [
      { direction: 'INBOUND', content: 'What time do you open on Sunday?' },
      { direction: 'OUTBOUND', content: 'We open at 9am on Sunday for sure.', sender: ai },
    ]);
    const { service, ai: provider } = build([aiOnly]);
    await expect(service.learnFromConversations('t1')).resolves.toEqual({ created: 0 });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('skips an article that duplicates an existing one, and creates nothing when the provider fails', async () => {
    const dup = build([goodConv], [{ title: 'Delivery to Kumasi', content: 'x' }]);
    dup.ai.complete.mockResolvedValue(reply([{ title: 'delivery to kumasi', content: 'GHS 45' }]));
    await expect(dup.service.learnFromConversations('t1')).resolves.toEqual({ created: 0 });
    const failed = build([goodConv]);
    failed.ai.complete.mockResolvedValue({ failed: true, content: '' });
    await expect(failed.service.learnFromConversations('t1')).resolves.toEqual({ created: 0 });
    expect(failed.prisma.knowledgeBaseArticle.create).not.toHaveBeenCalled();
  });

  it('is scoped to the caller\'s tenant and makes no provider call without a key', async () => {
    const scoped = build([goodConv]);
    scoped.ai.complete.mockResolvedValue(reply([]));
    await scoped.service.learnFromConversations('tenant-9');
    expect(scoped.prisma.conversation.findMany.mock.calls[0][0].where.tenantId).toBe('tenant-9');
    expect(scoped.prisma.knowledgeBaseArticle.findMany.mock.calls[0]?.[0]?.where?.tenantId ?? 'tenant-9').toBe('tenant-9');
    process.env.DEEPSEEK_API_KEY = '';
    const noKey = build([goodConv]);
    await expect(noKey.service.learnFromConversations('t1')).resolves.toEqual({ created: 0 });
    expect(noKey.ai.complete).not.toHaveBeenCalled();
  });

  it('a malformed model reply creates nothing', async () => {
    const { service, ai: provider, prisma } = build([goodConv]);
    provider.complete.mockResolvedValue({ failed: false, content: 'Sure! here are some articles but no json' });
    await expect(service.learnFromConversations('t1')).resolves.toEqual({ created: 0 });
    expect(prisma.knowledgeBaseArticle.create).not.toHaveBeenCalled();
  });
});
