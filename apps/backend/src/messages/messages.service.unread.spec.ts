import { MessagesService } from './messages.service';

type Conv = { id: string; channelId: string; status: string; unreadCount: number };

function setup(conv: Conv, updatedRow: { unreadCount?: number; status?: string } | undefined, alreadyProcessed = false) {
  const contactsService = { findOrCreate: jest.fn().mockResolvedValue({ id: 'ct1', phone: '+233555000111', name: null }) };
  const conversationsService = { findOrCreate: jest.fn().mockResolvedValue(conv), request: jest.fn() };
  const created = { id: 'm1', createdAt: new Date('2026-10-15T10:00:00Z') };
  const prisma = {
    message: { findFirst: jest.fn().mockResolvedValue(alreadyProcessed ? { id: 'existing' } : null), create: jest.fn().mockResolvedValue(created) },
    conversation: { update: jest.fn().mockResolvedValue(updatedRow) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const realtimeService = { emitNewMessage: jest.fn(), emitConversationUpdated: jest.fn() };
  const args: unknown[] = new Array(21).fill({});
  args[0] = prisma; args[2] = conversationsService; args[3] = contactsService; args[4] = realtimeService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (MessagesService as any)(...args) as MessagesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jest.spyOn(service as any, 'dispatchAiAndChatbot').mockResolvedValue(undefined);
  return { service, prisma, realtimeService };
}

const emitted = (rt: { emitConversationUpdated: jest.Mock }) => rt.emitConversationUpdated.mock.calls[0][2] as Record<string, unknown>;

describe('inbound customer message -> unread badge', () => {
  it('a reply on a reopened (previously resolved) chat shows as 1 unread with the new inbound time', async () => {
    const { service, realtimeService } = setup({ id: 'cv1', channelId: 'chan1', status: 'REQUESTED', unreadCount: 0 }, { unreadCount: 1, status: 'REQUESTED' });
    await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-1', { content: 'Are you there?' });
    expect(emitted(realtimeService)).toMatchObject({ id: 'cv1', unreadCount: 1, status: 'REQUESTED', lastInboundAt: new Date('2026-10-15T10:00:00Z') });
  });

  it('reports the count the database holds after the atomic increment, not a stale in-memory copy (two quick messages)', async () => {
    // The conversation was read when the count was 4, but a concurrent message already bumped it: the DB now says 6.
    const { service, realtimeService } = setup({ id: 'cv1', channelId: 'chan1', status: 'REQUESTED', unreadCount: 4 }, { unreadCount: 6, status: 'REQUESTED' });
    await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-2', { content: 'hello' });
    expect(emitted(realtimeService).unreadCount).toBe(6);
  });

  it('emits the real status after the update, not the stale pre-update one that made the chat flip back to OPEN', async () => {
    const { service, realtimeService } = setup({ id: 'cv1', channelId: 'chan1', status: 'OPEN', unreadCount: 0 }, { unreadCount: 1, status: 'REQUESTED' });
    await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-3', { content: 'hi' });
    expect(emitted(realtimeService).status).toBe('REQUESTED');
  });

  it('falls back to a safe estimate when the update row is unavailable', async () => {
    const { service, realtimeService } = setup({ id: 'cv1', channelId: 'chan1', status: 'REQUESTED', unreadCount: 2 }, undefined);
    await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-4', { content: 'hi' });
    expect(emitted(realtimeService).unreadCount).toBe(3);
  });

  it('a duplicate delivery of the same provider message does not increment or emit again', async () => {
    const { service, prisma, realtimeService } = setup({ id: 'cv1', channelId: 'chan1', status: 'REQUESTED', unreadCount: 1 }, { unreadCount: 2 }, true);
    await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-1', { content: 'Are you there?' });
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(realtimeService.emitConversationUpdated).not.toHaveBeenCalled();
    expect(realtimeService.emitNewMessage).not.toHaveBeenCalled();
  });

  it('increments by exactly one per genuine message, in the same transaction as the message', async () => {
    const { service, prisma } = setup({ id: 'cv1', channelId: 'chan1', status: 'REQUESTED', unreadCount: 0 }, { unreadCount: 1 });
    await service.handleInboundWhatsAppWeb('t1', 'chan1', '233555000111', 'wa-5', { content: 'hi' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.conversation.update.mock.calls[0][0]).toMatchObject({ where: { id: 'cv1' }, data: { unreadCount: { increment: 1 } } });
  });
});
