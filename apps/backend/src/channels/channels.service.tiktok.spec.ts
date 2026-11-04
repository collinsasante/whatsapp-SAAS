import { Logger } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { ChannelsService } from './channels.service';

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const USER_URL = 'https://open.tiktokapis.com/v2/user/info/';
const REDIRECT = 'https://staging.example.test/api/v1/channels/oauth/tiktok/callback';

const SECRETS = {
  clientSecret: 'CLIENT-SECRET-VALUE-9f2c', code: 'AUTH-CODE-VALUE-71ab', access: 'act.ACCESS-TOKEN-VALUE-1', refresh: 'rft.REFRESH-TOKEN-VALUE-1',
};
const SUCCESS = { access_token: SECRETS.access, expires_in: 7200, refresh_token: SECRETS.refresh, refresh_expires_in: 15552000, open_id: 'open-id-123', scope: 'user.info.basic', token_type: 'Bearer' };
const LIVE_ERROR = { error: 'invalid_grant', error_description: 'Authorization code is expired.', log_id: '202611041208248D2E4ECAA3C0A20D01F7' };

const res = (body: unknown, status = 200) => ({ status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)), json: () => Promise.resolve(body) });

function build(opts: { existing?: Record<string, unknown> | null; history?: number } = {}) {
  const prisma = {
    channel: {
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ch-new', ...data })),
      update: jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
    conversation: { count: jest.fn().mockResolvedValue(opts.history ?? 0) },
    facebookPageConnection: { updateMany: jest.fn() },
  };
  const values: Record<string, string> = { TIKTOK_CLIENT_ID: 'client-key-abc', TIKTOK_CLIENT_SECRET: SECRETS.clientSecret };
  const config = { get: jest.fn((k: string) => values[k]) };
  const encryption = { encrypt: jest.fn((v: string) => `enc:v1:${Buffer.from(v).toString('base64')}`), decrypt: jest.fn((v: string) => Buffer.from(v.replace(/^enc:v1:/, ''), 'base64').toString()) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ChannelsService(prisma as any, config as any, {} as any, encryption as any, audit as any);
  return { service, prisma, config, encryption, audit, values };
}

describe('ChannelsService: TikTok connect', () => {
  const realFetch = global.fetch;
  let logged: string[];
  beforeEach(() => {
    logged = [];
    for (const m of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, m).mockImplementation((msg: unknown) => { logged.push(String(msg)); });
  });
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connect = (service: ChannelsService, code = SECRETS.code) => (service as any).connectTikTok('tenant-A', code, REDIRECT) as Promise<void>;
  const expectNoSecrets = () => { for (const line of logged) for (const s of Object.values(SECRETS)) expect(line).not.toContain(s); };

  it('exchanges the code with the documented request and stores the account for the calling tenant, tokens encrypted', async () => {
    const f = jest.fn(async (url: string | URL) => String(url).startsWith(TOKEN_URL) ? res(SUCCESS) : res({ data: { user: { display_name: 'Ada Shop' } }, error: { code: 'ok', message: '', log_id: 'L' } }));
    global.fetch = f as never;
    const { service, prisma } = build();

    await connect(service);

    const [tokenUrl, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe(TOKEN_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ client_key: 'client-key-abc', client_secret: SECRETS.clientSecret, code: SECRETS.code, grant_type: 'authorization_code', redirect_uri: REDIRECT });

    const created = prisma.channel.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ tenantId: 'tenant-A', type: ChannelType.TIKTOK, name: 'Ada Shop', externalId: 'open-id-123', isActive: true });
    expect(created.credentials.accessToken).toMatch(/^enc:v1:/);
    expect(created.credentials.refreshToken).toMatch(/^enc:v1:/);
    expect(JSON.stringify(created)).not.toContain(SECRETS.access);
    expect(JSON.stringify(created)).not.toContain(SECRETS.refresh);
    expect(created.credentials).toMatchObject({ openId: 'open-id-123', scope: 'user.info.basic' });
    expect(Date.parse(created.credentials.tokenExpiresAt)).toBeGreaterThan(Date.now() + 7000 * 1000);
    expect(Date.parse(created.credentials.refreshExpiresAt)).toBeGreaterThan(Date.now() + 15000000 * 1000);
    expectNoSecrets();
  });

  it('REGRESSION: TikTok\'s real error body is reported with its code, description and log id, not as "unknown", and is logged without any secret', async () => {
    global.fetch = jest.fn().mockResolvedValue(res(LIVE_ERROR)) as never;
    const { service, prisma } = build();

    await expect(connect(service)).rejects.toThrow('TikTok authorization failed [invalid_grant]: Authorization code is expired. (TikTok ref 202611041208248D2E4ECAA3C0A20D01F7)');
    await expect(connect(service)).rejects.not.toThrow(/unknown/);
    expect(prisma.channel.create).not.toHaveBeenCalled();
    expect(prisma.channel.update).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain('error=invalid_grant');
    expect(logged.join('\n')).toContain('log_id=202611041208248D2E4ECAA3C0A20D01F7');
    expectNoSecrets();
  });

  it('a network failure or timeout gives a clear retry message and never leaks the request', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error(`connect ETIMEDOUT while sending ${SECRETS.clientSecret}`), { name: 'TimeoutError' })) as never;
    const { service, prisma } = build();
    await expect(connect(service)).rejects.toThrow('TikTok could not be reached. Please try connecting again.');
    expect(prisma.channel.create).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain('TimeoutError');
    expectNoSecrets();
  });

  it('refuses cleanly when the app credentials are not configured', async () => {
    global.fetch = jest.fn() as never;
    const { service, values } = build();
    delete values['TIKTOK_CLIENT_SECRET'];
    await expect(connect(service)).rejects.toThrow('tiktok is not configured on this server');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still connects, with a generic name, when the profile lookup fails; the failure is logged without secrets', async () => {
    global.fetch = jest.fn(async (url: string | URL) => String(url).startsWith(TOKEN_URL) ? res(SUCCESS) : res({ error: { code: 'scope_not_authorized', message: `needs scope for ${SECRETS.access}`, log_id: 'L9' } })) as never;
    const { service, prisma } = build();
    await connect(service);
    expect(prisma.channel.create.mock.calls[0][0].data.name).toBe('TikTok Account');
    expect(logged.join('\n')).toContain('scope_not_authorized');
    expectNoSecrets();
  });

  it('reconnecting the same TikTok account updates the existing channel (same open_id), re-activates it and does not create a duplicate', async () => {
    global.fetch = jest.fn(async (url: string | URL) => String(url).startsWith(TOKEN_URL) ? res(SUCCESS) : res({ data: { user: { display_name: 'Ada Shop' } }, error: { code: 'ok' } })) as never;
    const { service, prisma, audit } = build({ existing: { id: 'ch-1', tenantId: 'tenant-A', type: 'TIKTOK', externalId: 'open-id-123', isActive: false } });
    await connect(service);
    expect(prisma.channel.create).not.toHaveBeenCalled();
    expect(prisma.channel.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ch-1' }, data: expect.objectContaining({ isActive: true, externalId: 'open-id-123' }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ action: 'OAUTH_RECONNECT' }) }));
  });

  it('tenant isolation: the lookup for an existing channel is always scoped to the tenant carried by the signed state', async () => {
    global.fetch = jest.fn(async (url: string | URL) => String(url).startsWith(TOKEN_URL) ? res(SUCCESS) : res({ data: { user: {} }, error: { code: 'ok' } })) as never;
    const { service, prisma } = build();
    await connect(service);
    expect(prisma.channel.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: 'tenant-A', type: ChannelType.TIKTOK });
  });
});

describe('ChannelsService: TikTok disconnect', () => {
  const realFetch = global.fetch;
  let logged: string[];
  beforeEach(() => { logged = []; for (const m of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(Logger.prototype, m).mockImplementation((msg: unknown) => { logged.push(String(msg)); }); });
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  const tiktokChannel = (extra: Record<string, unknown> = {}) => ({
    id: 'ch-1', tenantId: 'tenant-A', type: ChannelType.TIKTOK, name: 'Ada Shop', externalId: 'open-id-123',
    credentials: { accessToken: `enc:v1:${Buffer.from(SECRETS.access).toString('base64')}`, refreshToken: `enc:v1:${Buffer.from(SECRETS.refresh).toString('base64')}`, openId: 'open-id-123', externalId: 'open-id-123', tokenExpiresAt: '2026-11-04T14:00:00.000Z' },
    ...extra,
  });

  it('revokes at TikTok with the decrypted access token, then (with history) disconnects softly and removes every stored token', async () => {
    const f = jest.fn().mockResolvedValue(res('{}'));
    global.fetch = f as never;
    const { service, prisma } = build({ history: 3 });
    prisma.channel.findFirst.mockResolvedValue(tiktokChannel());

    const out = await service.remove('tenant-A', 'ch-1', 'user-1');

    expect(out).toEqual({ success: true, removed: false });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(REVOKE_URL);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ client_key: 'client-key-abc', client_secret: SECRETS.clientSecret, token: SECRETS.access });
    const update = prisma.channel.update.mock.calls[0][0];
    expect(update.data.isActive).toBe(false);
    expect(update.data.credentials).toEqual({ externalId: 'open-id-123', openId: 'open-id-123' });
    expect(JSON.stringify(update)).not.toMatch(/enc:v1|act\.|rft\./);
    for (const line of logged) for (const s of Object.values(SECRETS)) expect(line).not.toContain(s);
  });

  it('disconnect still succeeds when TikTok is unreachable or refuses the revoke, and the failure is logged', async () => {
    const { service, prisma } = build({ history: 0 });
    prisma.channel.findFirst.mockResolvedValue(tiktokChannel());
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { name: 'TimeoutError' })) as never;
    await expect(service.remove('tenant-A', 'ch-1')).resolves.toEqual({ success: true, removed: true });
    expect(prisma.channel.delete).toHaveBeenCalledWith({ where: { id: 'ch-1' } });
    expect(logged.join('\n')).toContain('revoke could not be completed');

    logged.length = 0; prisma.channel.delete.mockClear();
    global.fetch = jest.fn().mockResolvedValue(res({ error: 'invalid_request', error_description: 'The request parameters are malformed.', log_id: 'LOGX' })) as never;
    await expect(service.remove('tenant-A', 'ch-1')).resolves.toEqual({ success: true, removed: true });
    expect(logged.join('\n')).toContain('revoke was refused');
    expect(logged.join('\n')).toContain('invalid_request');
  });

  it('only the owning tenant can disconnect: another tenant\'s channel id is not found and nothing is revoked', async () => {
    global.fetch = jest.fn() as never;
    const { service, prisma } = build();
    prisma.channel.findFirst.mockResolvedValue(null);
    await expect(service.remove('tenant-B', 'ch-1')).rejects.toThrow('Channel not found');
    expect(prisma.channel.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'ch-1', tenantId: 'tenant-B' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('other channel types are untouched: no TikTok call for a Telegram bot (only Telegram\'s own deleteWebhook)', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true }))) as never;
    const { service, prisma } = build();
    prisma.channel.findFirst.mockResolvedValue({ id: 'ch-2', tenantId: 'tenant-A', type: ChannelType.TELEGRAM, name: 'bot', credentials: { botToken: 'x' } });
    await service.remove('tenant-A', 'ch-2');
    const urls = (global.fetch as jest.Mock).mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('tiktok'))).toBe(false);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^https:\/\/api\.telegram\.org\/bot.*\/deleteWebhook$/);
  });
});
