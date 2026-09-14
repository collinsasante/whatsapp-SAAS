import { PushTokenService } from './push-token.service';

function build() {
  const prisma = {
    pushToken: {
      upsert: jest.fn().mockResolvedValue({ id: 'pt-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const service = new PushTokenService(prisma as never);
  return { service, prisma };
}

describe('PushTokenService', () => {
  it('upserts by token, not by [userId, token] -- a device moving to a new user updates the same row', async () => {
    const { service, prisma } = build();
    await service.register('user-1', 'tenant-1', 'ExponentPushToken[abc]', 'ios');
    expect(prisma.pushToken.upsert).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[abc]' },
      create: { userId: 'user-1', tenantId: 'tenant-1', token: 'ExponentPushToken[abc]', platform: 'ios' },
      update: { userId: 'user-1', tenantId: 'tenant-1', platform: 'ios' },
    });
  });

  it('unregister deletes by token value', async () => {
    const { service, prisma } = build();
    await service.unregister('ExponentPushToken[abc]');
    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: 'ExponentPushToken[abc]' } });
  });

  it('getTokensForUser returns just the token strings', async () => {
    const { service, prisma } = build();
    prisma.pushToken.findMany.mockResolvedValue([{ token: 'a' }, { token: 'b' }]);
    const tokens = await service.getTokensForUser('user-1');
    expect(tokens).toEqual(['a', 'b']);
    expect(prisma.pushToken.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1' }, select: { token: true } });
  });

  it('pruneInvalid does nothing (and never touches the DB) for an empty list', async () => {
    const { service, prisma } = build();
    await service.pruneInvalid([]);
    expect(prisma.pushToken.deleteMany).not.toHaveBeenCalled();
  });

  it('pruneInvalid deletes exactly the given tokens', async () => {
    const { service, prisma } = build();
    await service.pruneInvalid(['bad-1', 'bad-2']);
    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({ where: { token: { in: ['bad-1', 'bad-2'] } } });
  });

  it('pruneInvalid never throws even if the delete fails', async () => {
    const { service, prisma } = build();
    prisma.pushToken.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(service.pruneInvalid(['bad-1'])).resolves.toBeUndefined();
  });
});
