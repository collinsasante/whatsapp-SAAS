import { Logger } from '@nestjs/common';
import { ChannelsService } from './channels.service';

const SECRET_USER_TOKEN = 'LONG-LIVED-USER-TOKEN-xyz';

function build(appConfigured = true) {
  const prisma = {
    oAuthConnectSession: { create: jest.fn().mockResolvedValue({ id: 'sess-1' }), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const config = { get: jest.fn((k: string) => (k === 'FACEBOOK_APP_ID' ? (appConfigured ? 'APP1' : undefined) : k === 'FACEBOOK_APP_SECRET' ? (appConfigured ? 'APPSECRET' : undefined) : 'x')) };
  const encryption = { encrypt: (v: string) => `enc(${v})`, decrypt: (v: string) => v };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new ChannelsService(prisma as any, config as any, {} as any, encryption as any, { log: jest.fn() } as any), prisma };
}

const reply = (body: unknown) => ({ json: () => Promise.resolve(body) });
const page = (id: string, ig?: string) => ({ id, name: `Secret Business ${id}`, access_token: `PAGE-TOKEN-${id}`, ...(ig && { instagram_business_account: { id: ig, username: `user_${ig}` } }) });

describe('connect diagnostics', () => {
  const realFetch = global.fetch;
  let lines: string[];
  beforeEach(() => {
    lines = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { lines.push(String(m)); });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => { lines.push(String(m)); });
  });
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  const tokens = () => [reply({ access_token: 'short' }), reply({ access_token: SECRET_USER_TOKEN })];

  it('logs how many accounts Meta returned and how many Pages the login was granted, and nothing identifying', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(tokens()[0]).mockResolvedValueOnce(tokens()[1])
      .mockResolvedValueOnce(reply({ data: [page('p1', 'ig1'), page('p2'), page('p3', 'ig3')] }))
      .mockResolvedValueOnce(reply({ data: { scopes: ['pages_show_list', 'instagram_basic'], granular_scopes: [{ scope: 'pages_show_list', target_ids: ['p1', 'p2', 'p3'] }, { scope: 'instagram_basic', target_ids: ['ig1', 'ig3'] }] } }));
    global.fetch = f as never;
    const { service } = build();

    await service.startInstagramAccountSelection('t1', 'u1', 'code', 'cb');

    const text = lines.join('\n');
    expect(text).toContain('Meta returned 3 account(s)');
    expect(text).toContain('Instagram: 2 account(s) found across 3 Page(s)');
    expect(text).toContain('pages_show_list=3 target(s)');
    expect(text).toContain('instagram_basic=2 target(s)');
    for (const secret of [SECRET_USER_TOKEN, 'PAGE-TOKEN', 'APPSECRET', 'Secret Business', 'user_ig', 'p1', 'ig1']) expect(text).not.toContain(secret);
  });

  it('never breaks connecting when the access lookup fails', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(tokens()[0]).mockResolvedValueOnce(tokens()[1])
      .mockResolvedValueOnce(reply({ data: [page('p1', 'ig1')] }))
      .mockRejectedValueOnce(new Error('network down'));
    global.fetch = f as never;
    const { service, prisma } = build();

    await expect(service.startInstagramAccountSelection('t1', 'u1', 'code', 'cb')).resolves.toEqual({ sessionId: 'sess-1', accountCount: 1 });
    expect(prisma.oAuthConnectSession.create).toHaveBeenCalledTimes(1);
    expect(lines.join('\n')).toContain('Could not read the granted access');
    expect(lines.join('\n')).not.toContain(SECRET_USER_TOKEN);
  });

  it('skips the lookup silently when the Meta app is not configured', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(tokens()[0]).mockResolvedValueOnce(tokens()[1])
      .mockResolvedValueOnce(reply({ data: [page('p1', 'ig1')] }));
    global.fetch = f as never;
    const { service } = build(false);
    await service.startInstagramAccountSelection('t1', 'u1', 'code', 'cb');
    expect(f).toHaveBeenCalledTimes(3);
  });
});
