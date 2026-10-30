import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TestChatMessageDto } from './ai-test-chat.controller';
import { SimulationLimitReachedException, SimulationUnavailableException } from '../simulation/simulation-limits.service';
import { isSimulatedPhone } from '@whatsapp-platform/shared-utils';
import { AiTestChatService } from './ai-test-chat.service';
import { SimulationLimitsService } from '../simulation/simulation-limits.service';
import { MemorySimulationStore } from '../simulation/simulation-store';

function buildPrismaMock() {
  return {
    tenantSettings: { findUnique: jest.fn() },
    contact: { findFirst: jest.fn(), create: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn() },
    message: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    aiExecution: { findMany: jest.fn().mockResolvedValue([]) },
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
    service = new AiTestChatService(prisma as any, messagesService as any, conversationsService as any, new SimulationLimitsService({ get: () => undefined } as never, new MemorySimulationStore()));
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

  describe('which conversation a send uses', () => {
    beforeEach(() => {
      prisma.tenantSettings.findUnique.mockResolvedValue({ aiEnabled: true });
      prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Test Customer (you)' });
      prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SIMULATED', aiResponse: 'Hi!' });
      prisma.message.findFirst.mockResolvedValue({ id: 'msg-1', content: 'Hi!', metadata: { simulated: true } });
    });

    it('reuses the conversation reset() just created (resolved) instead of creating a second one, so what was done to it applies to the reply', async () => {
      prisma.conversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'reset-conv' }); // none open, then the most recent resolved
      const result = await service.sendMessage('t1', 'u1', 'How much is the red shirt?');

      expect(prisma.conversation.create).not.toHaveBeenCalled();
      expect(result.conversationId).toBe('reset-conv');
      expect(prisma.conversation.findFirst).toHaveBeenNthCalledWith(2, { where: { tenantId: 't1', contactId: 'contact-1', status: 'RESOLVED' }, orderBy: { updatedAt: 'desc' } });
    });

    it('prefers an open conversation over a resolved one, as the message pipeline does', async () => {
      prisma.conversation.findFirst.mockResolvedValueOnce({ id: 'open-conv' });
      const result = await service.sendMessage('t1', 'u1', 'hi');
      expect(result.conversationId).toBe('open-conv');
      expect(prisma.conversation.findFirst).toHaveBeenCalledTimes(1);
    });

    it('only creates a conversation when the contact has none at all', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({ id: 'brand-new' });
      const result = await service.sendMessage('t1', 'u1', 'hi');
      expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
      expect(result.conversationId).toBe('brand-new');
    });

    it('the conversation reset() hands out is the one the next send answers in (the Digital Self preview depends on it)', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null); // nothing open, nothing resolved yet
      prisma.conversation.create.mockResolvedValue({ id: 'reset-conv' });
      const { conversationId: handedOut } = await service.reset('t1', 'u1');

      prisma.conversation.findFirst.mockReset();
      prisma.conversation.create.mockReset();
      prisma.conversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: handedOut }); // it is now the most recent resolved
      const sent = await service.sendMessage('t1', 'u1', 'hi');

      expect(sent.conversationId).toBe(handedOut);
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });
  });

  describe('simulated-AI limits', () => {
    const FIXED = () => new Date('2026-10-29T10:00:30.000Z');
    const build = (env: Record<string, string> = {}, tenantStore = new MemorySimulationStore()) => {
      const limits = new SimulationLimitsService({ get: (k: string) => env[k] } as never, tenantStore, FIXED);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new AiTestChatService(prisma as any, messagesService as any, conversationsService as any, limits);
      return { svc, limits };
    };
    const ready = () => {
      prisma.tenantSettings.findUnique.mockResolvedValue({ aiEnabled: true });
      prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1', name: 'Test Customer (you)' });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      prisma.aiInteractionLog.findFirst.mockResolvedValue({ id: 'log-1', status: 'SIMULATED', aiResponse: 'Hi!' });
      prisma.message.findFirst.mockResolvedValue({ id: 'msg-1', content: 'Hi!', metadata: { simulated: true } });
    };
    const caught = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e; } };

    beforeEach(ready);

    it('a normal message is processed and takes one unit of the allowance', async () => {
      const { svc, limits } = build();
      const r = await svc.sendMessage('t1', 'u1', 'How much is delivery?');
      expect(r.mode).toBe('SIMULATED');
      expect(messagesService.handleInbound).toHaveBeenCalledTimes(1);
      expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(1);
    });

    it('rejects an oversized message before anything is spent or sent', async () => {
      const { svc, limits } = build({ AI_SIM_MAX_INPUT_CHARS: '20' });
      const err = (await caught(svc.sendMessage('t1', 'u1', 'x'.repeat(21)))) as BadRequestException;
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'SIMULATION_INPUT_TOO_LONG', limit: 20 });
      expect(messagesService.handleInbound).not.toHaveBeenCalled();
      expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(0);
    });

    it('measures the message after trimming (surrounding whitespace is not charged against the limit)', async () => {
      const { svc } = build({ AI_SIM_MAX_INPUT_CHARS: '5' });
      await expect(svc.sendMessage('t1', 'u1', '   hello   ')).resolves.toBeDefined();
    });

    it('asks for a new conversation when this one is full, scoped to this tenant and conversation, spending nothing', async () => {
      const { svc, limits } = build({ AI_SIM_MAX_CONVERSATION_TURNS: '3' });
      prisma.message.count.mockResolvedValue(3);
      const err = (await caught(svc.sendMessage('t1', 'u1', 'hi'))) as BadRequestException;
      expect(err.getResponse()).toMatchObject({ code: 'SIMULATION_CONVERSATION_TOO_LONG', limit: 3 });
      expect(prisma.message.count).toHaveBeenCalledWith({ where: { tenantId: 't1', conversationId: 'conv-1', direction: 'INBOUND' } });
      expect(messagesService.handleInbound).not.toHaveBeenCalled();
      expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(0);
    });

    it('does not run when Verz AI is disabled, and spends nothing', async () => {
      const { svc, limits } = build();
      prisma.tenantSettings.findUnique.mockResolvedValue({ aiEnabled: false });
      expect(await caught(svc.sendMessage('t1', 'u1', 'hi'))).toBeInstanceOf(BadRequestException);
      expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(0);
    });

    it('refuses with 429 once the daily allowance is spent, without calling the AI or any channel', async () => {
      const { svc } = build({ AI_SIM_DAILY_REQUESTS: '2', AI_SIM_USER_PER_MINUTE: '60' });
      await svc.sendMessage('t1', 'u1', 'one');
      await svc.sendMessage('t1', 'u1', 'two');
      const err = (await caught(svc.sendMessage('t1', 'u1', 'three'))) as SimulationLimitReachedException;
      expect(err).toBeInstanceOf(SimulationLimitReachedException);
      expect(err.getResponse()).toMatchObject({ code: 'SIMULATION_LIMIT_REACHED', scope: 'tenant_daily', limit: 2, used: 2 });
      expect(messagesService.handleInbound).toHaveBeenCalledTimes(2);
    });

    it('a limit-reached response falls back to nothing: no message is stored and no mode is reported', async () => {
      const { svc } = build({ AI_SIM_DAILY_REQUESTS: '0' });
      const err = await caught(svc.sendMessage('t1', 'u1', 'hi'));
      expect(err).toBeInstanceOf(SimulationLimitReachedException);
      expect(messagesService.handleInbound).not.toHaveBeenCalled();
    });

    describe('retries', () => {
      it('a retry of a processed send (same clientMessageId) returns the stored result and does not call the AI again', async () => {
        const { svc, limits } = build();
        const first = await svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0001');
        const second = await svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0001');
        expect(messagesService.handleInbound).toHaveBeenCalledTimes(1);
        expect(second).toMatchObject({ ...(first as object), replayed: true });
        expect((first as { replayed?: boolean }).replayed).toBeUndefined();
        expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(1);
      });

      it('a TIMEOUT result is remembered too, so retrying it does not start a second paid call while the first may still be running', async () => {
        jest.useFakeTimers();
        try {
          const { svc } = build();
          prisma.aiInteractionLog.findFirst.mockResolvedValue(null);
          prisma.message.findFirst.mockResolvedValue(null);
          const pending = svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0002');
          await jest.advanceTimersByTimeAsync(21_000);
          expect((await pending).mode).toBe('TIMEOUT');
          const retry = await svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0002');
          expect(retry).toMatchObject({ mode: 'TIMEOUT', replayed: true });
          expect(messagesService.handleInbound).toHaveBeenCalledTimes(1);
        } finally { jest.useRealTimers(); }
      });

      it('when the AI call throws, a retry with the same id is refused (409) and the AI is not called again', async () => {
        const { svc, limits } = build();
        messagesService.handleInbound.mockRejectedValueOnce(new Error('provider timed out'));
        expect(await caught(svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0003'))).toBeInstanceOf(Error);
        const retry = (await caught(svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0003'))) as ConflictException;
        expect(retry).toBeInstanceOf(ConflictException);
        expect(retry.getResponse()).toMatchObject({ code: 'SIMULATION_REQUEST_ALREADY_PROCESSED' });
        expect(messagesService.handleInbound).toHaveBeenCalledTimes(1);
        expect((await limits.usage('t1', 'u1')).used.requestsToday).toBe(1);
      });

      it('replaying the send that filled the conversation still returns its result', async () => {
        const { svc } = build({ AI_SIM_MAX_CONVERSATION_TURNS: '1' });
        await svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0004');
        prisma.message.count.mockResolvedValue(1); // the conversation is now full
        await expect(svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0004')).resolves.toMatchObject({ replayed: true });
        expect(await caught(svc.sendMessage('t1', 'u1', 'hi', 'client-msg-0005'))).toBeInstanceOf(BadRequestException);
      });

      it('retries are bounded by the allowance: every NEW id still spends a unit', async () => {
        const { svc } = build({ AI_SIM_DAILY_REQUESTS: '3', AI_SIM_USER_PER_MINUTE: '60' });
        messagesService.handleInbound.mockRejectedValue(new Error('down'));
        const outcomes: string[] = [];
        for (let i = 0; i < 6; i++) outcomes.push(((await caught(svc.sendMessage('t1', 'u1', 'hi', `client-msg-${100 + i}`))) as Error).constructor.name);
        expect(messagesService.handleInbound).toHaveBeenCalledTimes(3);
        expect(outcomes.slice(3)).toEqual(Array(3).fill('SimulationLimitReachedException'));
      });
    });

    it('simultaneous sends cannot exceed the allowance', async () => {
      const { svc } = build({ AI_SIM_DAILY_REQUESTS: '3', AI_SIM_USER_PER_MINUTE: '60' });
      messagesService.handleInbound.mockImplementation(() => new Promise((r) => setImmediate(() => r(null))));
      const out = await Promise.all(Array.from({ length: 12 }, (_v, i) => svc.sendMessage('t1', 'u1', `m${i}`, `client-msg-${200 + i}`).then(() => 'ok', (e) => (e instanceof SimulationLimitReachedException ? 'refused' : 'error'))));
      expect(out.filter((x) => x === 'ok')).toHaveLength(3);
      expect(out).not.toContain('error');
      expect(messagesService.handleInbound).toHaveBeenCalledTimes(3);
    });

    it('refuses with 503 and calls nothing when the counters are unavailable', async () => {
      const { svc } = build({}, { reserve: () => Promise.reject(new Error('redis down')), read: jest.fn(), claim: jest.fn(), get: jest.fn(), set: jest.fn(), del: jest.fn() } as never);
      expect(await caught(svc.sendMessage('t1', 'u1', 'hi'))).toBeInstanceOf(SimulationUnavailableException);
      expect(messagesService.handleInbound).not.toHaveBeenCalled();
    });

    it('tenants are independent: one tenant spending its allowance does not block another', async () => {
      const store = new MemorySimulationStore();
      const a = build({ AI_SIM_DAILY_REQUESTS: '1' }, store).svc;
      await a.sendMessage('t1', 'u1', 'hi');
      expect(await caught(a.sendMessage('t1', 'u1', 'hi again'))).toBeInstanceOf(SimulationLimitReachedException);
      await expect(a.sendMessage('t2', 'u1', 'hi')).resolves.toBeDefined();
    });

    describe('usage report', () => {
      it('combines the counters with the provider usage recorded today for THIS tenant\'s simulated runs only', async () => {
        const { svc } = build();
        await svc.sendMessage('t1', 'u1', 'hi');
        prisma.aiExecution.findMany.mockResolvedValue([
          { modelKey: 'deepseek-v4-flash', status: 'SUCCESS', inputTokens: 1000, outputTokens: 200, estCostUsd: null },
          { modelKey: 'deepseek-v4-flash', status: 'PROVIDER_ERROR', inputTokens: null, outputTokens: null, estCostUsd: null },
        ]);
        const u = await svc.getUsage('t1', 'u1');
        expect(u.used.requestsToday).toBe(1);
        expect(u.limits.dailyRequests).toBe(200);
        expect(u.providerUsageToday).toMatchObject({ calls: 2, succeeded: 1, inputTokens: 1000, outputTokens: 200, callsWithoutTokenCounts: 1, costEstimateComplete: false });
        const where = prisma.aiExecution.findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ tenantId: 't1', taskType: 'TEST', safetyFlags: { path: ['simulated'], equals: true } });
        expect(where.createdAt.gte.toISOString()).toMatch(/T00:00:00\.000Z$/);
      });

      it('accepts a Decimal-typed stored cost', async () => {
        const { svc } = build();
        prisma.aiExecution.findMany.mockResolvedValue([{ modelKey: 'deepseek-v4-flash', status: 'SUCCESS', inputTokens: 1, outputTokens: 1, estCostUsd: { valueOf: () => '0.25' } }]);
        expect((await svc.getUsage('t1', 'u1')).providerUsageToday.estimatedCostUsd).toBe(0.25);
      });

      it('exposes no secret and no other tenant', async () => {
        const { svc } = build({ AI_SIM_TENANT_OVERRIDES: JSON.stringify({ 'tenant-other': { dailyRequests: 9 } }) });
        const body = JSON.stringify(await svc.getUsage('t1', 'u1'));
        expect(body).not.toContain('tenant-other');
        expect(body).not.toMatch(/api[_-]?key|secret|token":|password/i);
      });

      it('is a 503, not zeros, when the counters are unavailable', async () => {
        const { svc } = build({}, { read: () => Promise.reject(new Error('down')) } as never);
        expect(await caught(svc.getUsage('t1', 'u1'))).toBeInstanceOf(SimulationUnavailableException);
      });
    });
  });

  describe('request validation (DTO)', () => {
    const check = async (body: Record<string, unknown>) => (await validate(plainToInstance(TestChatMessageDto, body))).map((e) => e.property);
    it('accepts a message with and without a client id', async () => {
      expect(await check({ message: 'hi' })).toEqual([]);
      expect(await check({ message: 'hi', clientMessageId: 'abcd1234-ef56' })).toEqual([]);
    });
    it.each([['empty', { message: '' }], ['too long (hard cap)', { message: 'x'.repeat(4001) }], ['not a string', { message: 5 }]])('rejects a message that is %s', async (_l, body) => {
      expect(await check(body)).toContain('message');
    });
    it.each(['short', 'has space in it', 'a'.repeat(65), 'bad/chars!!', 7 as unknown as string])('rejects a malformed clientMessageId (%p)', async (id) => {
      expect(await check({ message: 'hi', clientMessageId: id })).toContain('clientMessageId');
    });
  });
});
