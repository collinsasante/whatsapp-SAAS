import { BadRequestException } from '@nestjs/common';
import { AiTestChatService } from './ai-test-chat.service';

function buildPrismaMock() {
  return {
    tenantSettings: { findUnique: jest.fn() },
    contact: { findFirst: jest.fn(), create: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn() },
    message: { findMany: jest.fn(), findFirst: jest.fn() },
    aiInteractionLog: { findMany: jest.fn(), findFirst: jest.fn() },
  };
}

function buildMessagesServiceMock() {
  return { handleInbound: jest.fn().mockResolvedValue(null) };
}

function buildConversationsServiceMock() {
  return { resolve: jest.fn().mockResolvedValue(null) };
}

describe('AiTestChatService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let messagesService: ReturnType<typeof buildMessagesServiceMock>;
  let conversationsService: ReturnType<typeof buildConversationsServiceMock>;
  let service: AiTestChatService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    messagesService = buildMessagesServiceMock();
    conversationsService = buildConversationsServiceMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new AiTestChatService(prisma as any, messagesService as any, conversationsService as any);
  });

  describe('ensureAiEnabled (via getState)', () => {
    it('rejects when Verz AI is not enabled for the tenant', async () => {
      prisma.tenantSettings.findUnique.mockResolvedValue({ aiEnabled: false });

      await expect(service.getState('t1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('phone consistency', () => {
    it('generates a purely numeric phone (after the +) so normalizePhone cannot mangle it', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const phone = (service as any).phoneFor('some-uuid-1234-abcd');
      expect(phone).toMatch(/^\+\d+$/);
    });

    it('is deterministic for the same userId', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = (service as any).phoneFor('user-abc');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (service as any).phoneFor('user-abc');
      expect(a).toBe(b);
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      prisma.tenantSettings.findUnique.mockResolvedValue({ aiEnabled: true });
      prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Test Customer (you)' });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    });

    it('rejects an empty message', async () => {
      await expect(service.sendMessage('t1', 'u1', '   ')).rejects.toBeInstanceOf(BadRequestException);
      expect(messagesService.handleInbound).not.toHaveBeenCalled();
    });

    it('calls handleInbound with the real production shape (text type, from = the same phone used for lookup)', async () => {
      prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SUGGESTED' });
      prisma.message.findFirst.mockResolvedValue(null);

      await service.sendMessage('t1', 'u1', 'How much is delivery?');

      expect(messagesService.handleInbound).toHaveBeenCalledTimes(1);
      const [tenantId, waMessage] = messagesService.handleInbound.mock.calls[0];
      expect(tenantId).toBe('t1');
      expect(waMessage.type).toBe('text');
      expect(waMessage.text.body).toBe('How much is delivery?');
      expect(waMessage.from).toMatch(/^\d+$/); // no '+' in the wire format, matching real webhook payloads
    });

    it('returns SUGGESTION mode when a new AiInteractionLog appears', async () => {
      prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SUGGESTED', aiResponse: 'Hi!' });
      prisma.message.findFirst.mockResolvedValue(null);

      const result = await service.sendMessage('t1', 'u1', 'hi');

      expect(result.mode).toBe('SUGGESTION');
      expect(result.suggestion).toEqual({ id: 'log-1', status: 'SUGGESTED', aiResponse: 'Hi!' });
    });

    it('returns AUTO_REPLY mode when a new outbound Message appears instead', async () => {
      prisma.aiInteractionLog.findFirst.mockResolvedValue(null);
      prisma.message.findFirst.mockResolvedValue({ id: 'msg-1', content: 'Hi there!' });

      const result = await service.sendMessage('t1', 'u1', 'hi');

      expect(result.mode).toBe('AUTO_REPLY');
      expect(result.message).toEqual({ id: 'msg-1', content: 'Hi there!' });
    });
  });

  describe('reset (forceNew)', () => {
    beforeEach(() => {
      prisma.tenantSettings.findUnique.mockResolvedValue({ aiEnabled: true });
      prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Test Customer (you)' });
    });

    it('resolves a dangling non-resolved conversation before starting a new one, so handleInbound never writes to it again', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 'stale-conv' });
      prisma.conversation.create.mockResolvedValue({ id: 'fresh-conv' });

      const result = await service.reset('t1', 'u1');

      expect(conversationsService.resolve).toHaveBeenCalledWith('t1', 'stale-conv', 'u1');
      expect(result.conversationId).toBe('fresh-conv');
    });

    it('does not call resolve when there is no dangling conversation', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'fresh-conv' });

      await service.reset('t1', 'u1');

      expect(conversationsService.resolve).not.toHaveBeenCalled();
    });
  });
});
