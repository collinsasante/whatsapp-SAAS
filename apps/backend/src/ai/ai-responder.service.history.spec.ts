import { HISTORY_FETCH_BUFFER } from '../ai-core/context/history-select.util';
import axios from 'axios';
import { AiResponderService, ProviderCallWrapper } from './ai-responder.service';

jest.mock('axios');

describe('AiResponderService.generateSuggestion -- history scoping', () => {
  const OLD_KEY = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'unit-test-placeholder'; // axios is mocked: no network call is possible
    (axios.post as jest.Mock).mockResolvedValue({ data: { choices: [{ message: { content: '{"response":"ok","confidence":90}' } }] } });
  });
  afterAll(() => { process.env.DEEPSEEK_API_KEY = OLD_KEY; });

  function build(conversation: unknown) {
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
      tenantSettings: { findUnique: jest.fn().mockResolvedValue({ businessName: 'Acme', aiPersonality: null }) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const kb = { getRelevant: jest.fn().mockResolvedValue([]) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { prisma, service: new AiResponderService(prisma as any, kb as any, { getGuidanceBlock: async () => '' } as any) };
  }

  it('looks the conversation up WITH tenantId (the old findUnique by id alone was tenant-blind)', async () => {
    const { prisma, service } = build({ id: 'c1', contactId: 'contact-1' });
    await service.generateSuggestion('t1', 'c1', 'hello');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', tenantId: 't1' } }));
  });

  it('runs the provider request through an optional reservation wrapper', async () => {
    const { service } = build({ id: 'c1', contactId: 'contact-1' });
    let wrapperCalled = false;
    const wrapper: ProviderCallWrapper = async <T>(providerCall: () => Promise<T>) => {
      wrapperCalled = true;
      return providerCall();
    };

    await service.generateSuggestion('t1', 'c1', 'hello', undefined, wrapper);

    expect(wrapperCalled).toBe(true);
  });

  it('scopes history to tenant + contact and keeps the 200-message window', async () => {
    const { prisma, service } = build({ id: 'c1', contactId: 'contact-1' });
    await service.generateSuggestion('t1', 'c1', 'hello');
    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 't1', conversation: { tenantId: 't1', contactId: 'contact-1' } }),
      take: 200 + HISTORY_FETCH_BUFFER,
    }));
  });

  it('runs no message query (empty history) when the conversation is not found for this tenant', async () => {
    const { prisma, service } = build(null);
    await service.generateSuggestion('t1', 'c-other-tenant', 'hello');
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('falls back to conversationId (tenant-scoped) for a missing/invalid contactId, never an absent filter', async () => {
    for (const contactId of [undefined, null, '']) {
      const { prisma, service } = build({ id: 'c1', contactId });
      await service.generateSuggestion('t1', 'c1', 'hello');
      const where = prisma.message.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ tenantId: 't1', conversationId: 'c1' }));
      expect(where).not.toHaveProperty('conversation');
    }
  });
});

describe('AiResponderService.generateSuggestion -- reviewed corrections', () => {
  const OLD_KEY = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'unit-test-placeholder';
    (axios.post as jest.Mock).mockReset().mockResolvedValue({ data: { choices: [{ message: { content: '{"response":"ok","confidence":90}' } }] } });
  });
  afterAll(() => { process.env.DEEPSEEK_API_KEY = OLD_KEY; });

  function build(corrections: { getGuidanceBlock: jest.Mock }) {
    const prisma = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', contactId: 'contact-1' }) },
      tenantSettings: { findUnique: jest.fn().mockResolvedValue({ businessName: 'Acme', aiPersonality: null }) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const kb = { getRelevant: jest.fn().mockResolvedValue([]) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new AiResponderService(prisma as any, kb as any, corrections as any);
  }
  const sentSystemPrompt = () => (axios.post as jest.Mock).mock.calls[0][1].messages[0].content as string;

  it("asks for this tenant's guidance for this message and adds it to the system prompt", async () => {
    const corrections = { getGuidanceBlock: jest.fn().mockResolvedValue('\n\nREVIEWED GUIDANCE FROM THIS BUSINESS ...\n- When a customer says something like "x": ...') };
    await build(corrections).generateSuggestion('t1', 'c1', 'deliver to Kumasi?');
    expect(corrections.getGuidanceBlock).toHaveBeenCalledWith('t1', 'deliver to Kumasi?');
    expect(sentSystemPrompt()).toContain('REVIEWED GUIDANCE FROM THIS BUSINESS');
  });

  it('still replies, without guidance, when the lookup fails', async () => {
    const corrections = { getGuidanceBlock: jest.fn().mockRejectedValue(new Error('db down')) };
    await expect(build(corrections).generateSuggestion('t1', 'c1', 'hello')).resolves.toBeDefined();
    expect(sentSystemPrompt()).not.toContain('REVIEWED GUIDANCE');
  });
});
