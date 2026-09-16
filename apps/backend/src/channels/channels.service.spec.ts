import { ChannelsService } from './channels.service';

function buildPrismaMock() {
  return {
    channel: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    whatsAppNumber: {
      findFirst: jest.fn(),
    },
  };
}

function buildDeps() {
  return {
    prisma: buildPrismaMock(),
    config: { get: jest.fn() },
    whatsAppNumbers: { create: jest.fn(), update: jest.fn() },
    audit: { log: jest.fn().mockResolvedValue(undefined) },
  };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ChannelsService(deps.prisma as any, deps.config as any, deps.whatsAppNumbers as any, deps.audit as any);
}

describe('ChannelsService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('create (non-WhatsApp)', () => {
    it('audit-logs a CREATE for a directly-created channel', async () => {
      const deps = buildDeps();
      deps.prisma.channel.create.mockResolvedValue({ id: 'c1', type: 'FACEBOOK_MESSENGER', name: 'My Page' });
      const service = buildService(deps);

      await service.create('t1', { type: 'FACEBOOK_MESSENGER', name: 'My Page' } as any, 'user-1');

      expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 't1', userId: 'user-1', action: 'CREATE', resource: 'channel', resourceId: 'c1',
      }));
    });
  });

  describe('update (non-WhatsApp)', () => {
    it('audit-logs an UPDATE without leaking credential values into metadata', async () => {
      const deps = buildDeps();
      deps.prisma.channel.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', type: 'FACEBOOK_MESSENGER', credentials: {} });
      deps.prisma.channel.update.mockResolvedValue({ id: 'c1' });
      const service = buildService(deps);

      await service.update('t1', 'c1', { name: 'Renamed', credentials: { accessToken: 'secret' } } as any, 'user-1');

      expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'UPDATE', resource: 'channel', resourceId: 'c1',
        metadata: { changes: ['name'] }, // 'credentials' key itself excluded, not its value
      }));
    });
  });

  describe('toggle', () => {
    it('audit-logs the resulting isActive state', async () => {
      const deps = buildDeps();
      deps.prisma.channel.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', isActive: true });
      deps.prisma.channel.update.mockResolvedValue({ id: 'c1', isActive: false });
      const service = buildService(deps);

      await service.toggle('t1', 'c1', 'user-1');

      expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1', action: 'UPDATE', resource: 'channel', resourceId: 'c1',
        metadata: { action: 'TOGGLE', isActive: false },
      }));
    });
  });

  describe('remove', () => {
    it('audit-logs a DELETE with the channel type/name captured before it is gone', async () => {
      const deps = buildDeps();
      deps.prisma.channel.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', type: 'TELEGRAM', name: '@my_bot' });
      const service = buildService(deps);

      await service.remove('t1', 'c1', 'user-1');

      expect(deps.prisma.channel.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1', action: 'DELETE', resource: 'channel', resourceId: 'c1',
        metadata: { type: 'TELEGRAM', name: '@my_bot' },
      }));
    });
  });

  describe('connectTelegramBot', () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    it('audit-logs OAUTH_CONNECT for a brand-new bot', async () => {
      const deps = buildDeps();
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, result: { id: 123, username: 'my_bot' } }),
      }) as unknown as typeof fetch;
      deps.prisma.channel.findFirst.mockResolvedValue(null); // no existing channel -- new connect
      deps.prisma.channel.create.mockResolvedValue({ id: 'c1', type: 'TELEGRAM', name: '@my_bot' });
      const service = buildService(deps);

      await service.connectTelegramBot('t1', 'bot-token', 'user-1');

      expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1', action: 'CREATE', resource: 'channel', resourceId: 'c1',
        metadata: expect.objectContaining({ action: 'OAUTH_CONNECT' }),
      }));
    });

    it('audit-logs OAUTH_RECONNECT (UPDATE) when the same bot id already has a channel', async () => {
      const deps = buildDeps();
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, result: { id: 123, username: 'my_bot' } }),
      }) as unknown as typeof fetch;
      deps.prisma.channel.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1' }); // existing channel for this bot id
      deps.prisma.channel.update.mockResolvedValue({ id: 'c1', type: 'TELEGRAM', name: '@my_bot' });
      const service = buildService(deps);

      await service.connectTelegramBot('t1', 'bot-token', 'user-1');

      expect(deps.prisma.channel.create).not.toHaveBeenCalled();
      expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'UPDATE', resource: 'channel', resourceId: 'c1',
        metadata: expect.objectContaining({ action: 'OAUTH_RECONNECT' }),
      }));
    });
  });
});
