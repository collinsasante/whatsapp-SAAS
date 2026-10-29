import { BadRequestException } from '@nestjs/common';
import { isSimulatedPhone } from '@whatsapp-platform/shared-utils';
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

    it('always lies in the reserved simulated range, so no provider layer will ever accept it as a recipient', () => {
      for (const id of ['u1', 'some-uuid-1234-abcd', '', 'x'.repeat(200), '00000000-0000-0000-0000-000000000000']) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isSimulatedPhone((service as any).phoneFor(id))).toBe(true);
      }
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

    it('hands the inbound pipeline a phone in the reserved range (so it, and every layer below it, treats the customer as simulated)', async () => {
      prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SUGGESTED' });
      prisma.message.findFirst.mockResolvedValue(null);
      await service.sendMessage('t1', 'u1', 'hi');
      expect(isSimulatedPhone(messagesService.handleInbound.mock.calls[0][1].from)).toBe(true);
    });

    describe('the reported mode comes from what was recorded, never from the mere existence of a log', () => {
      afterEach(() => jest.useRealTimers());

      it('a SUGGESTED log is a draft: SUGGESTION, with no message', async () => {
        prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SUGGESTED', aiResponse: 'Hi!' });
        prisma.message.findFirst.mockResolvedValue(null);
        const r = await service.sendMessage('t1', 'u1', 'hi');
        expect(r.mode).toBe('SUGGESTION');
        expect(r.message).toBeNull();
      });

      it('a SIMULATED log with its stored message is SIMULATED and carries both', async () => {
        prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SIMULATED', aiResponse: 'Hi!' });
        prisma.message.findFirst.mockResolvedValue({ id: 'msg-1', content: 'Hi!', metadata: { aiGenerated: true, simulated: true } });
        const r = await service.sendMessage('t1', 'u1', 'hi');
        expect(r.mode).toBe('SIMULATED');
        expect(r.suggestion).toMatchObject({ id: 'log-1', status: 'SIMULATED' });
        expect(r.message).toMatchObject({ id: 'msg-1' });
      });

      it('a SIMULATED log whose message lands a moment later waits for it (the log is written first)', async () => {
        jest.useFakeTimers();
        prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SIMULATED', aiResponse: 'Hi!' });
        prisma.message.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'msg-1', content: 'Hi!', metadata: { simulated: true } });
        const pending = service.sendMessage('t1', 'u1', 'hi');
        await jest.advanceTimersByTimeAsync(1_000);
        const r = await pending;
        expect(r.mode).toBe('SIMULATED');
        expect(r.message).toMatchObject({ id: 'msg-1' });
      });

      it('a SIMULATED log whose message never appears is returned after a short grace, not after the full timeout', async () => {
        jest.useFakeTimers();
        prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SIMULATED', aiResponse: 'Hi!' });
        prisma.message.findFirst.mockResolvedValue(null);
        const pending = service.sendMessage('t1', 'u1', 'hi');
        await jest.advanceTimersByTimeAsync(4_000);
        const r = await pending;
        expect(r.mode).toBe('SIMULATED');
        expect(r.message).toBeNull();
      });

      it('an outbound message with no log (welcome message, flow step, provider-failure apology) is SIMULATED when marked so', async () => {
        prisma.aiInteractionLog.findFirst.mockResolvedValue(null);
        prisma.message.findFirst.mockResolvedValue({ id: 'msg-1', content: 'Welcome!', metadata: { simulated: true } });
        const r = await service.sendMessage('t1', 'u1', 'hi');
        expect(r.mode).toBe('SIMULATED');
        expect(r.suggestion).toBeNull();
      });

      it('REGRESSION: a log recorded as AUTO_SENT is never presented as "suggested"; it is an ERROR that says so', async () => {
        prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'AUTO_SENT', aiResponse: 'Hi!' });
        prisma.message.findFirst.mockResolvedValue(null);
        const r = await service.sendMessage('t1', 'u1', 'hi');
        expect(r.mode).toBe('ERROR');
        expect(r.mode).not.toBe('SUGGESTION');
        expect((r as { note?: string }).note).toMatch(/AUTO_SENT/);
      });

      it('an outbound message that is NOT marked simulated is an ERROR, not an AUTO_REPLY', async () => {
        prisma.aiInteractionLog.findFirst.mockResolvedValue(null);
        prisma.message.findFirst.mockResolvedValue({ id: 'msg-1', content: 'Hi there!', metadata: { aiGenerated: true } });
        const r = await service.sendMessage('t1', 'u1', 'hi');
        expect(r.mode).toBe('ERROR');
        expect((r as { note?: string }).note).toMatch(/not marked as simulated/);
      });

      it('an outbound message with no metadata at all is also an ERROR', async () => {
        prisma.aiInteractionLog.findFirst.mockResolvedValue(null);
        prisma.message.findFirst.mockResolvedValue({ id: 'msg-1', content: 'Hi there!', metadata: null });
        expect((await service.sendMessage('t1', 'u1', 'hi')).mode).toBe('ERROR');
      });

      it('nothing recorded within the timeout is TIMEOUT', async () => {
        jest.useFakeTimers();
        prisma.aiInteractionLog.findFirst.mockResolvedValue(null);
        prisma.message.findFirst.mockResolvedValue(null);
        const pending = service.sendMessage('t1', 'u1', 'hi');
        await jest.advanceTimersByTimeAsync(21_000);
        expect((await pending).mode).toBe('TIMEOUT');
      });
    });
  });

  describe('getState', () => {
    it('returns each message\'s metadata, so the page can show a message as simulated', async () => {
      prisma.tenantSettings.findUnique.mockResolvedValue({ aiEnabled: true });
      prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Test Customer (you)' });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      prisma.message.findMany.mockResolvedValue([]);
      prisma.aiInteractionLog.findMany.mockResolvedValue([]);
      await service.getState('t1', 'u1');
      expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ metadata: true }) }));
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
