import { NotificationsService } from './notifications.service';
import { NotificationType } from '@prisma/client';

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function build() {
  const prisma = {
    notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
  };
  const realtime = { emitToUser: jest.fn() };
  const pushTokens = { getTokensForUser: jest.fn().mockResolvedValue([]), pruneInvalid: jest.fn().mockResolvedValue(undefined) };
  const expoPush = { send: jest.fn().mockResolvedValue({ invalidTokens: [] }) };
  const service = new NotificationsService(prisma as never, realtime as never, pushTokens as never, expoPush as never);
  return { service, prisma, realtime, pushTokens, expoPush };
}

const baseDto = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  type: NotificationType.CONVERSATION_ASSIGNED,
  title: 'Conversation assigned to you',
  body: 'A conversation with Jane has been assigned to you',
};

describe('NotificationsService.create', () => {
  it('creates the in-app notification and emits the realtime event as before (unchanged behavior)', async () => {
    const { service, prisma, realtime } = build();
    const result = await service.create(baseDto);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(realtime.emitToUser).toHaveBeenCalledWith('user-1', 'notification:new', result);
  });

  it('does not send a push when the user has no registered devices', async () => {
    const { service, pushTokens, expoPush } = build();
    await service.create(baseDto);
    await flushMicrotasks();
    expect(pushTokens.getTokensForUser).toHaveBeenCalledWith('user-1');
    expect(expoPush.send).not.toHaveBeenCalled();
  });

  it('sends a push with the same title/body once the user has a device registered', async () => {
    const { service, pushTokens, expoPush } = build();
    pushTokens.getTokensForUser.mockResolvedValue(['ExponentPushToken[abc]']);

    await service.create(baseDto);
    await flushMicrotasks();

    expect(expoPush.send).toHaveBeenCalledWith(
      ['ExponentPushToken[abc]'],
      expect.objectContaining({ title: baseDto.title, body: baseDto.body }),
    );
  });

  it('includes conversationId in the push data payload when present in metadata, for mobile\'s deep-link-on-tap', async () => {
    const { service, pushTokens, expoPush } = build();
    pushTokens.getTokensForUser.mockResolvedValue(['token-1']);

    await service.create({ ...baseDto, metadata: { conversationId: 'conv-42' } });
    await flushMicrotasks();

    expect(expoPush.send).toHaveBeenCalledWith(['token-1'], expect.objectContaining({ data: expect.objectContaining({ conversationId: 'conv-42' }) }));
  });

  it('omits conversationId from the push data when not present in metadata (never fabricates one)', async () => {
    const { service, pushTokens, expoPush } = build();
    pushTokens.getTokensForUser.mockResolvedValue(['token-1']);

    await service.create(baseDto);
    await flushMicrotasks();

    const call = expoPush.send.mock.calls[0][1];
    expect(call.data).not.toHaveProperty('conversationId');
  });

  it('prunes tokens Expo reports as invalid', async () => {
    const { service, pushTokens, expoPush } = build();
    pushTokens.getTokensForUser.mockResolvedValue(['stale-token']);
    expoPush.send.mockResolvedValue({ invalidTokens: ['stale-token'] });

    await service.create(baseDto);
    await flushMicrotasks();

    expect(pushTokens.pruneInvalid).toHaveBeenCalledWith(['stale-token']);
  });

  it('still creates the in-app notification even if the push send throws', async () => {
    const { service, prisma, pushTokens, expoPush } = build();
    pushTokens.getTokensForUser.mockResolvedValue(['token-1']);
    expoPush.send.mockRejectedValue(new Error('expo api down'));

    const result = await service.create(baseDto);
    await flushMicrotasks();

    expect(result).toEqual({ id: 'notif-1' });
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('create() resolves without waiting for the push send to complete (fire-and-forget)', async () => {
    const { service, pushTokens, expoPush } = build();
    pushTokens.getTokensForUser.mockResolvedValue(['token-1']);
    let resolveSend: () => void = () => undefined;
    expoPush.send.mockReturnValue(new Promise((resolve) => { resolveSend = () => resolve({ invalidTokens: [] }); }));

    await service.create(baseDto); // must not hang waiting on the still-pending send()
    resolveSend();
  });
});
