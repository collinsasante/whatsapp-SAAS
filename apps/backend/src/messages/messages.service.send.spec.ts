import { BadRequestException } from '@nestjs/common';
import { MessagesService } from './messages.service';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const H = 60 * 60 * 1000;

function setup(opts: { channelType?: string; lastInboundAt?: Date | null; assignedTo?: { id: string; isAiAgent?: boolean } | null; status?: string } = {}) {
  const prisma = {
    message: {
      findFirst: jest.fn().mockResolvedValue(opts.lastInboundAt ? { createdAt: opts.lastInboundAt } : null),
      create: jest.fn().mockResolvedValue({ id: 'm1' }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data })),
      findUnique: jest.fn().mockResolvedValue({ id: 'm1', status: 'SENT' }),
    },
  };
  const conversationsService = {
    // lastMessageAt is deliberately FRESH: outbound sends bump it, and it must not keep the window open.
    findOne: jest.fn().mockResolvedValue({
      id: 'c1', contactId: 'ct1', status: opts.status ?? 'OPEN', assignedTo: opts.assignedTo ?? null, lastMessageAt: new Date(NOW),
      channel: { id: 'ch1', type: opts.channelType ?? 'WHATSAPP' }, contact: { id: 'ct1' }, whatsappNumberId: null,
    }),
    touchLastMessage: jest.fn().mockResolvedValue(undefined),
    incrementUnread: jest.fn(),
    autoReopenIfResolved: jest.fn(),
  };
  const contactsService = { findOne: jest.fn().mockResolvedValue({ id: 'ct1', phone: '+233555000111', isBlocked: false, optedOut: false }) };
  const whatsappService = { sendTextMessage: jest.fn().mockResolvedValue('wamid.1') };
  const realtimeService = { emitNewMessage: jest.fn() };
  const knowledgeBaseService = { triggerLearningAsync: jest.fn() };
  const whatsAppWebService = { sendText: jest.fn().mockResolvedValue('web-1') };
  const args: unknown[] = new Array(21).fill({});
  args[0] = prisma; args[1] = whatsappService; args[2] = conversationsService; args[3] = contactsService;
  args[4] = realtimeService; args[9] = knowledgeBaseService; args[20] = whatsAppWebService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (MessagesService as any)(...args) as MessagesService;
  return { service, prisma, conversationsService, whatsappService, whatsAppWebService };
}

describe('MessagesService.sendMessage -- ownership', () => {
  it('rejects a send into a conversation owned by another human agent, without persisting or reopening anything', async () => {
    const { service, prisma, conversationsService, whatsappService } = setup({ lastInboundAt: new Date(NOW - H), assignedTo: { id: 'other', isAiAgent: false }, status: 'RESOLVED' });
    await expect(service.sendMessage('t1', 'c1', 'u1', { type: 'IMAGE', mediaUrl: 'http://x/y.png' } as never)).rejects.toThrow('another agent');
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(conversationsService.autoReopenIfResolved).not.toHaveBeenCalled();
    expect(whatsappService.sendTextMessage).not.toHaveBeenCalled();
  });
  it('allows the owner, and conversations owned by the AI agent', async () => {
    for (const assignedTo of [{ id: 'u1', isAiAgent: false }, { id: 'ai', isAiAgent: true }, null]) {
      const { service, whatsappService } = setup({ lastInboundAt: new Date(NOW - H), assignedTo });
      await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hi' } as never);
      expect(whatsappService.sendTextMessage).toHaveBeenCalledTimes(1);
    }
  });
});

describe('MessagesService.sendMessage -- delivery integrity', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it('rejects a free-form WhatsApp send when the last INBOUND is >24h old, even if lastMessageAt is fresh', async () => {
    const { service, whatsappService } = setup({ lastInboundAt: new Date(NOW - 25 * H) });
    await expect(service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hi' } as never)).rejects.toThrow(BadRequestException);
    expect(whatsappService.sendTextMessage).not.toHaveBeenCalled();
  });

  it('allows a send when the last inbound is within 24h', async () => {
    const { service, whatsappService } = setup({ lastInboundAt: new Date(NOW - 23 * H) });
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hi' } as never);
    expect(whatsappService.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('does not apply the window to WhatsApp Web conversations', async () => {
    const { service, whatsAppWebService } = setup({ channelType: 'WHATSAPP_WEB', lastInboundAt: null });
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hi' } as never);
    expect(whatsAppWebService.sendText).toHaveBeenCalledTimes(1);
  });

  it('marks a media message with no mediaUrl FAILED instead of SENT (nothing was dispatched)', async () => {
    const { service, prisma } = setup({ lastInboundAt: new Date(NOW - H) });
    const result = await service.sendMessage('t1', 'c1', 'u1', { type: 'IMAGE' } as never);
    expect(result).toMatchObject({ status: 'FAILED' });
    const statuses = prisma.message.update.mock.calls.map((c) => c[0].data.status);
    expect(statuses).not.toContain('SENT');
  });

  it('a successful outbound send bumps recency without counting our own reply as unread', async () => {
    const { service, conversationsService } = setup({ lastInboundAt: new Date(NOW - H) });
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hi' } as never);
    expect(conversationsService.touchLastMessage).toHaveBeenCalledWith('c1');
    expect(conversationsService.incrementUnread).not.toHaveBeenCalled();
  });
});

describe('MessagesService.sendMessage -- idempotency (clientMessageId)', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());
  const dto = { type: 'TEXT', content: 'hi', clientMessageId: 'tmp-1' } as never;

  it('a retry with the same clientMessageId does not message the customer twice', async () => {
    const { service, whatsappService, prisma } = setup({ lastInboundAt: new Date(NOW - H) });
    const first = await service.sendMessage('t1', 'c1', 'u1', dto);
    const second = await service.sendMessage('t1', 'c1', 'u1', dto);
    expect(whatsappService.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('concurrent duplicates (double click) share one send', async () => {
    const { service, whatsappService } = setup({ lastInboundAt: new Date(NOW - H) });
    await Promise.all([service.sendMessage('t1', 'c1', 'u1', dto), service.sendMessage('t1', 'c1', 'u1', dto)]);
    expect(whatsappService.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('messages without an id are never deduplicated', async () => {
    const { service, whatsappService } = setup({ lastInboundAt: new Date(NOW - H) });
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hi' } as never);
    await service.sendMessage('t1', 'c1', 'u1', { type: 'TEXT', content: 'hi' } as never);
    expect(whatsappService.sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it('a FAILED send can be retried with the same id', async () => {
    const { service, whatsappService } = setup({ lastInboundAt: new Date(NOW - H) });
    whatsappService.sendTextMessage.mockRejectedValueOnce(new Error('provider down'));
    const failed = await service.sendMessage('t1', 'c1', 'u1', dto);
    expect(failed).toMatchObject({ status: 'FAILED' });
    await service.sendMessage('t1', 'c1', 'u1', dto);
    expect(whatsappService.sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it('the key is scoped to the sender, so another user\'s same id is a separate send', async () => {
    const { service, whatsappService } = setup({ lastInboundAt: new Date(NOW - H) });
    await service.sendMessage('t1', 'c1', 'u1', dto);
    await service.sendMessage('t1', 'c1', 'u2', dto);
    expect(whatsappService.sendTextMessage).toHaveBeenCalledTimes(2);
  });
});
