import { BadRequestException } from '@nestjs/common';
import { ChannelsService } from './channels.service';

const GRAPH = 'https://graph.facebook.com/v19.0';

function build() {
  const prisma = {
    channel: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    conversation: { count: jest.fn().mockResolvedValue(0) },
    facebookPageConnection: { updateMany: jest.fn() },
    oAuthConnectSession: { create: jest.fn().mockResolvedValue({ id: 'sess-1' }), findFirst: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ count: 0 }), delete: jest.fn() },
  };
  const config = { get: jest.fn().mockReturnValue('configured') };
  const encryption = { encrypt: jest.fn((v: string) => `enc(${v})`), decrypt: jest.fn((v: string) => v.replace(/^enc\((.*)\)$/, '$1')) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ChannelsService(prisma as any, config as any, {} as any, encryption as any, audit as any);
  return { service, prisma, encryption };
}

const reply = (body: unknown) => ({ json: () => Promise.resolve(body) });
const accounts = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, name: `Page ${from + i}`, access_token: `tok${from + i}` }));

describe('ChannelsService: every account is read, not just the first batch', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchAll = (service: ChannelsService, fields = 'id,name,access_token') => (service as any).fetchAllAccounts('USER_TOKEN', fields) as Promise<Array<{ id: string }>>;

  it('follows paging.next until Meta stops sending one: 27 Pages come back as 27', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(reply({ data: accounts(12), paging: { next: `${GRAPH}/me/accounts?after=B1&access_token=USER_TOKEN` } }))
      .mockResolvedValueOnce(reply({ data: accounts(12, 12), paging: { next: `${GRAPH}/me/accounts?after=B2&access_token=USER_TOKEN` } }))
      .mockResolvedValueOnce(reply({ data: accounts(3, 24) }));
    global.fetch = f as never;
    const { service } = build();

    const all = await fetchAll(service);

    expect(all).toHaveLength(27);
    expect(all.map((p) => p.id)).toEqual(Array.from({ length: 27 }, (_, i) => `p${i}`));
    expect(f).toHaveBeenCalledTimes(3);
    expect(String(f.mock.calls[0][0])).toContain('limit=100');
  });

  it('never follows a next link that points anywhere but Meta, so the token cannot be sent to another host', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(reply({ data: accounts(2), paging: { next: 'https://evil.example.com/steal?access_token=USER_TOKEN' } }))
      .mockResolvedValueOnce(reply({ data: accounts(5, 2) }));
    global.fetch = f as never;
    const { service } = build();

    expect(await fetchAll(service)).toHaveLength(2);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('stops after a fixed number of batches even if Meta always says there is more', async () => {
    const f = jest.fn().mockResolvedValue(reply({ data: accounts(1), paging: { next: `${GRAPH}/me/accounts?after=again` } }));
    global.fetch = f as never;
    const { service } = build();

    await fetchAll(service);
    expect(f).toHaveBeenCalledTimes(20);
  });

  it('reports an error from Meta instead of returning a partial list', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(reply({ data: accounts(2), paging: { next: `${GRAPH}/me/accounts?after=B1` } }))
      .mockResolvedValueOnce(reply({ error: { message: 'rate limited' } })) as never;
    const { service } = build();
    await expect(fetchAll(service)).rejects.toThrow('Failed to list Facebook Pages: rate limited');
  });
});

describe('ChannelsService: Instagram account selection', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const withIg = (id: string, ig: { id: string; username?: string; name?: string } | undefined) => ({ id, name: `Page ${id}`, access_token: `tok-${id}`, ...(ig && { instagram_business_account: ig }) });
  const tokenReplies = () => [reply({ access_token: 'short' }), reply({ access_token: 'long' })];

  it('lists the Instagram accounts across all Pages (including Pages beyond the first batch) and connects NOTHING yet', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(tokenReplies()[0]).mockResolvedValueOnce(tokenReplies()[1])
      .mockResolvedValueOnce(reply({ data: [withIg('p1', undefined), withIg('p2', { id: 'ig-a', username: 'shop_a' })], paging: { next: `${GRAPH}/me/accounts?after=B1` } }))
      .mockResolvedValueOnce(reply({ data: [withIg('p27', { id: 'ig-glam', username: 'glampack' })] }));
    global.fetch = f as never;
    const { service, prisma } = build();

    const result = await service.startInstagramAccountSelection('t1', 'u1', 'code', 'https://api/cb');

    expect(result).toEqual({ sessionId: 'sess-1', accountCount: 2 });
    const stored = prisma.oAuthConnectSession.create.mock.calls[0][0].data;
    expect(stored.provider).toBe('instagram');
    expect(stored.candidatePages).toEqual([
      { id: 'ig-a', name: '@shop_a', pageId: 'p2', pageName: 'Page p2' },
      { id: 'ig-glam', name: '@glampack', pageId: 'p27', pageName: 'Page p27' },
    ]);
    expect(JSON.stringify(stored.candidatePages)).not.toContain('tok-'); // Page tokens never go into the session
    expect(prisma.channel.create).not.toHaveBeenCalled();
    expect(prisma.channel.update).not.toHaveBeenCalled();
  });

  it('says how many Pages it checked when none has an Instagram account', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(tokenReplies()[0]).mockResolvedValueOnce(tokenReplies()[1])
      .mockResolvedValueOnce(reply({ data: [withIg('p1', undefined), withIg('p2', undefined)] })) as never;
    const { service, prisma } = build();
    await expect(service.startInstagramAccountSelection('t1', 'u1', 'c', 'cb')).rejects.toThrow(/among the 2 Pages you shared/);
    expect(prisma.oAuthConnectSession.create).not.toHaveBeenCalled();
  });

  const sessionRow = (ids: string[]) => ({ id: 'sess-1', tenantId: 't1', provider: 'instagram', userAccessToken: 'enc(long)', candidatePages: ids.map((id) => ({ id, name: id })), expiresAt: new Date(Date.now() + 60_000) });

  it('connects only the account that was picked, with its Page token stored encrypted', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(reply({ data: [withIg('p2', { id: 'ig-a', username: 'shop_a' }), withIg('p27', { id: 'ig-glam', username: 'glampack' })] })) as never;
    const { service, prisma } = build();
    prisma.oAuthConnectSession.findFirst.mockResolvedValue(sessionRow(['ig-a', 'ig-glam']));
    prisma.channel.create.mockResolvedValue({ id: 'ch-glam' });

    const result = await service.selectInstagramAccounts('t1', 'u1', 'sess-1', ['ig-glam']);

    expect(result.connected).toEqual([{ channelId: 'ch-glam', accountId: 'ig-glam', accountName: '@glampack' }]);
    expect(prisma.channel.create).toHaveBeenCalledTimes(1);
    const data = prisma.channel.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: 't1', type: 'INSTAGRAM', name: '@glampack', externalId: 'ig-glam' });
    expect(data.credentials.accessToken).toBe('enc(tok-p27)');
    expect(JSON.stringify(data.credentials)).not.toMatch(/"accessToken":"tok-/);
    expect(prisma.oAuthConnectSession.delete).toHaveBeenCalledWith({ where: { id: 'sess-1' } });
  });

  it('refuses an account that was not in the original list, and connects nothing', async () => {
    global.fetch = jest.fn() as never;
    const { service, prisma } = build();
    prisma.oAuthConnectSession.findFirst.mockResolvedValue(sessionRow(['ig-a']));
    await expect(service.selectInstagramAccounts('t1', 'u1', 'sess-1', ['ig-someone-elses'])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.channel.create).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("will not use another workspace's session", async () => {
    const { service, prisma } = build();
    prisma.oAuthConnectSession.findFirst.mockResolvedValue(null); // the lookup is keyed by tenantId
    await expect(service.selectFromSession('tenant-B', 'u1', 'sess-of-A', ['ig-a'])).rejects.toThrow(/expired or does not exist/);
    expect(prisma.oAuthConnectSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-B', id: 'sess-of-A' }) }));
  });

  it('selectFromSession hands an Instagram session to the Instagram flow and a Facebook session to the Facebook flow', async () => {
    const { service, prisma } = build();
    const ig = jest.spyOn(service, 'selectInstagramAccounts').mockResolvedValue({ connected: [] });
    const fb = jest.spyOn(service, 'selectFacebookPages').mockResolvedValue({ connected: [] });
    prisma.oAuthConnectSession.findFirst.mockResolvedValueOnce({ provider: 'instagram' }).mockResolvedValueOnce({ provider: 'facebook' });
    await service.selectFromSession('t1', 'u1', 's', ['x']);
    await service.selectFromSession('t1', 'u1', 's', ['y']);
    expect(ig).toHaveBeenCalledWith('t1', 'u1', 's', ['x']);
    expect(fb).toHaveBeenCalledWith('t1', 'u1', 's', ['y']);
  });

  it('the old connect-everything path is gone', async () => {
    const { service } = build();
    await expect(service.connectOAuth('instagram', 't1', 'code', 'cb')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChannelsService.remove: disconnect without losing history', () => {
  const channel = (type: string) => ({ id: 'c1', tenantId: 't1', type, name: 'x', isActive: true });

  it.each(['INSTAGRAM', 'TIKTOK', 'TELEGRAM'])('%s with no conversations is removed outright', async (type) => {
    const { service, prisma } = build();
    prisma.channel.findFirst.mockResolvedValue(channel(type));
    prisma.conversation.count.mockResolvedValue(0);
    await expect(service.remove('t1', 'c1', 'u1')).resolves.toEqual({ success: true, removed: true });
    expect(prisma.channel.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it.each(['INSTAGRAM', 'TIKTOK', 'TELEGRAM'])('%s with conversation history is only disconnected, never deleted', async (type) => {
    const { service, prisma } = build();
    prisma.channel.findFirst.mockResolvedValue(channel(type));
    prisma.conversation.count.mockResolvedValue(4);
    await expect(service.remove('t1', 'c1', 'u1')).resolves.toEqual({ success: true, removed: false });
    expect(prisma.channel.delete).not.toHaveBeenCalled();
    expect(prisma.channel.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: false } });
    expect(prisma.conversation.count).toHaveBeenCalledWith({ where: { tenantId: 't1', channelId: 'c1' } });
  });

  it("cannot disconnect another workspace's channel", async () => {
    const { service, prisma } = build();
    prisma.channel.findFirst.mockResolvedValue(null);
    await expect(service.remove('tenant-B', 'c-of-A')).rejects.toThrow('Channel not found');
    expect(prisma.channel.findFirst).toHaveBeenCalledWith({ where: { id: 'c-of-A', tenantId: 'tenant-B' } });
    expect(prisma.channel.delete).not.toHaveBeenCalled();
    expect(prisma.channel.update).not.toHaveBeenCalled();
  });

  it('Facebook stays a soft disconnect, as before', async () => {
    const { service, prisma } = build();
    prisma.channel.findFirst.mockResolvedValue(channel('FACEBOOK_MESSENGER'));
    await expect(service.remove('t1', 'c1', 'u1')).resolves.toEqual({ success: true, removed: false });
    expect(prisma.facebookPageConnection.updateMany).toHaveBeenCalledWith({ where: { tenantId: 't1', channelId: 'c1' }, data: { isActive: false } });
    expect(prisma.channel.delete).not.toHaveBeenCalled();
  });
});
