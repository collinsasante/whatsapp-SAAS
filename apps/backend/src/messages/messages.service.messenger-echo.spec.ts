import { Prisma } from '@prisma/client';
import { MessagesService } from './messages.service';

const CUSTOMER = 'PSID-9';

function build(opts: { existingMessage?: object | null; conversation?: Record<string, unknown> | null; createError?: Error } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    message: {
      findFirst: jest.fn().mockResolvedValue(opts.existingMessage ?? null),
      create: jest.fn((args: { data: Record<string, unknown> }) => { created.push(args.data); return { __create: true, ...args.data, id: 'm-new', createdAt: args.data['createdAt'] }; }),
    },
    conversation: {
      findFirst: jest.fn().mockResolvedValue(opts.conversation === undefined ? { id: 'c1', status: 'OPEN', channelId: 'ch1' } : opts.conversation),
      create: jest.fn().mockResolvedValue({ id: 'c-new', status: 'OPEN', channelId: 'ch1' }),
      update: jest.fn((args: object) => ({ __update: args })),
    },
    $transaction: jest.fn(async (ops: unknown[]) => {
      if (opts.createError) throw opts.createError;
      return ops;
    }),
  };
  const contactsService = { findOrCreateByExternalId: jest.fn().mockResolvedValue({ id: 'k1', name: 'Kojo' }) };
  const conversationsService = { findOrCreate: jest.fn(), request: jest.fn() };
  const realtimeService = { emitNewMessage: jest.fn(), emitConversationUpdated: jest.fn() };
  const dispatchAiAndChatbot = jest.fn();
  const svc = Object.create(MessagesService.prototype) as Record<string, unknown>;
  Object.assign(svc, { prisma, contactsService, conversationsService, realtimeService, dispatchAiAndChatbot, storageService: {}, logger: { warn: jest.fn(), log: jest.fn() } });
  return { svc: svc as unknown as MessagesService, prisma, contactsService, conversationsService, realtimeService, dispatchAiAndChatbot, created };
}

describe('MessagesService.handleMessengerEcho -- replies sent outside VerzChat', () => {
  const OWN = '1111';
  beforeEach(() => { process.env['FACEBOOK_APP_ID'] = OWN; });
  afterEach(() => { delete process.env['FACEBOOK_APP_ID']; });

  it('stores a reply typed in the Page inbox as an outbound message in the customer\'s latest conversation and shows it live', async () => {
    const { svc, prisma, created, realtimeService } = build();
    const r = await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.A', text: 'On my way' }, 1_800_000_000_000);

    expect(r.status).toBe('stored');
    expect(created[0]).toMatchObject({
      tenantId: 't1', conversationId: 'c1', contactId: 'k1', channelId: 'ch1', whatsappMessageId: 'mid.A',
      direction: 'OUTBOUND', status: 'SENT', content: 'On my way', metadata: { source: 'external' },
    });
    expect(created[0]['senderId']).toBeUndefined();
    expect((created[0]['createdAt'] as Date).getTime()).toBe(1_800_000_000_000);
    expect(prisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { lastMessageAt: new Date(1_800_000_000_000) } });
    expect(realtimeService.emitNewMessage).toHaveBeenCalledWith('t1', 'c1', expect.objectContaining({ whatsappMessageId: 'mid.A' }));
    expect(realtimeService.emitConversationUpdated).toHaveBeenCalledWith('t1', 'c1', expect.objectContaining({ id: 'c1' }));
  });

  it('records it only: no reopening, no team alert, no ownership change, no AI or chatbot', async () => {
    const { svc, conversationsService, dispatchAiAndChatbot, prisma } = build({ conversation: { id: 'c1', status: 'RESOLVED', channelId: 'ch1' } });
    await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.B', text: 'Thanks, all sorted' }, 1);
    expect(conversationsService.findOrCreate).not.toHaveBeenCalled();
    expect(conversationsService.request).not.toHaveBeenCalled();
    expect(dispatchAiAndChatbot).not.toHaveBeenCalled();
    const updates = (prisma.conversation.update.mock.calls as Array<[{ data: unknown }]>).map((c) => c[0].data);
    expect(updates).toEqual([{ lastMessageAt: new Date(1) }]); // status and assignee untouched
  });

  it('ignores the echo of a message VerzChat itself sent (it carries our app id)', async () => {
    const { svc, prisma } = build();
    expect(await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.OWN', text: 'AI reply', app_id: Number(OWN) }, 1)).toEqual({ status: 'own-app' });
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it('stores an echo from a different app and keeps which app sent it', async () => {
    const { svc, created } = build();
    await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.OTHER', text: 'hello', app_id: '263902037430900' }, 1);
    expect(created[0]['metadata']).toEqual({ source: 'external', appId: '263902037430900' });
  });

  it('when our own app id is not configured, skips any echo that names an app instead of risking a duplicate', async () => {
    delete process.env['FACEBOOK_APP_ID'];
    const { svc, prisma } = build();
    expect(await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.X', text: 'x', app_id: 5 }, 1)).toEqual({ status: 'own-app' });
    expect(prisma.message.create).not.toHaveBeenCalled();
    // ...but a reply typed in the Page inbox (no app id) is still stored
    expect((await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.Y', text: 'y' }, 1)).status).toBe('stored');
  });

  it('does not store the same echo twice (duplicate delivery, or Meta retry)', async () => {
    const { svc, prisma } = build({ existingMessage: { id: 'already' } });
    expect(await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.A', text: 'again' }, 1)).toEqual({ status: 'duplicate' });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('treats a unique-constraint race between two deliveries as a duplicate, not an error', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const { svc, realtimeService } = build({ createError: err });
    expect(await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.A', text: 'x' }, 1)).toEqual({ status: 'duplicate' });
    expect(realtimeService.emitNewMessage).not.toHaveBeenCalled();
  });

  it('lets other database errors surface so the webhook can fail and Meta retries, and emits nothing', async () => {
    const { svc, realtimeService } = build({ createError: new Error('db down') });
    await expect(svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.A', text: 'x' }, 1)).rejects.toThrow('db down');
    expect(realtimeService.emitNewMessage).not.toHaveBeenCalled();
  });

  it('opens a plain conversation when the customer has none yet, without alerting anyone', async () => {
    const { svc, prisma, conversationsService } = build({ conversation: null });
    await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: 'mid.A', text: 'hi' }, 1);
    expect(prisma.conversation.create).toHaveBeenCalledWith({ data: { tenantId: 't1', contactId: 'k1', channelId: 'ch1', status: 'OPEN' } });
    expect(conversationsService.findOrCreate).not.toHaveBeenCalled();
  });

  it('is scoped to the workspace: contact, conversation and duplicate lookups all carry the tenant', async () => {
    const { svc, prisma, contactsService } = build();
    await svc.handleMessengerEcho('tenant-X', 'ch1', CUSTOMER, { mid: 'mid.A', text: 'hi' }, 1);
    expect(contactsService.findOrCreateByExternalId).toHaveBeenCalledWith('tenant-X', 'MESSENGER_PSID', CUSTOMER);
    expect(prisma.message.findFirst.mock.calls[0][0].where.tenantId).toBe('tenant-X');
    expect(prisma.conversation.findFirst.mock.calls[0][0].where.tenantId).toBe('tenant-X');
  });

  it('uses the Instagram identity for an Instagram echo and ignores events with no customer or message id', async () => {
    const { svc, contactsService, prisma } = build();
    await svc.handleMessengerEcho('t1', 'ch1', 'IGSID-4', { mid: 'mid.IG', text: 'hi' }, 1, 'INSTAGRAM');
    expect(contactsService.findOrCreateByExternalId).toHaveBeenCalledWith('t1', 'INSTAGRAM_IGSID', 'IGSID-4');
    prisma.message.create.mockClear();
    expect(await svc.handleMessengerEcho('t1', 'ch1', '', { mid: 'mid.Z', text: 'x' }, 1)).toEqual({ status: 'ignored' });
    expect(await svc.handleMessengerEcho('t1', 'ch1', CUSTOMER, { mid: '', text: 'x' }, 1)).toEqual({ status: 'ignored' });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});
