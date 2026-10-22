import { WhatsAppNumbersService } from './whatsapp-numbers.service';

const TOKEN = 'EAAB-secret-token-123';

function build() {
  const prisma = {
    whatsAppNumber: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'n1', label: 'Main', phoneNumberId: 'p1' }),
      update: jest.fn().mockResolvedValue({ id: 'n1', isDefault: true }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'n1', phoneNumberId: 'p1', wabaId: 'w1', accessToken: `enc:${TOKEN}` }),
    },
    tenant: { update: jest.fn().mockResolvedValue({}) },
  };
  const warn = jest.fn();
  const service = Object.create(WhatsAppNumbersService.prototype) as WhatsAppNumbersService & Record<string, unknown>;
  Object.assign(service, {
    prisma,
    encryption: { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace(/^enc:/, '') },
    audit: { log: jest.fn().mockResolvedValue(undefined) },
    logger: { warn },
    findOne: jest.fn().mockResolvedValue({ id: 'n1' }),
    linkChannel: jest.fn().mockResolvedValue(undefined),
  });
  return { service, prisma, warn };
}

const createDto = { label: 'Main', phoneNumberId: 'p1', wabaId: 'w1', accessToken: TOKEN };
const metaReplies = (body: unknown) => jest.fn().mockResolvedValue({ json: () => Promise.resolve(body) });

describe('WhatsAppNumbersService webhook subscription is best effort', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('create: still saves the number when Meta refuses the subscription, and reports why', async () => {
    global.fetch = metaReplies({ error: { message: '(#200) Missing permissions' } }) as never;
    const { service, prisma } = build();

    const result = await service.create('t1', createDto);

    expect(prisma.whatsAppNumber.create).toHaveBeenCalledTimes(1);
    expect(prisma.tenant.update).toHaveBeenCalledTimes(1); // first number is default, so the tenant copy is synced
    expect(result).toMatchObject({ id: 'n1', webhookSubscription: { subscribed: false, reason: '(#200) Missing permissions' } });
  });

  it('create: still saves the number when Meta cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as never;
    const { service, prisma } = build();

    const result = await service.create('t1', createDto);

    expect(prisma.whatsAppNumber.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ webhookSubscription: { subscribed: false, reason: 'network down' } });
  });

  it('create: reports success when Meta confirms', async () => {
    global.fetch = metaReplies({ success: true }) as never;
    const { service } = build();
    await expect(service.create('t1', createDto)).resolves.toMatchObject({ webhookSubscription: { subscribed: true } });
  });

  it('update: a refusal from Meta no longer stops the credentials being synced to the tenant', async () => {
    global.fetch = metaReplies({ error: { message: 'Unsupported post request' } }) as never;
    const { service, prisma } = build();

    const result = await service.update('t1', 'n1', { wabaId: 'w1', accessToken: TOKEN });

    expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ wabaId: 'w1', accessToken: TOKEN }) }));
    expect(result).toMatchObject({ webhookSubscription: { subscribed: false, reason: 'Unsupported post request' } });
  });

  it('update: editing only the label does not call Meta at all', async () => {
    global.fetch = jest.fn() as never;
    const { service } = build();

    const result = await service.update('t1', 'n1', { label: 'Renamed' });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('webhookSubscription');
  });

  it('never puts the access token in the URL or in a log line', async () => {
    const fetchMock = metaReplies({ error: { message: 'bad token' } });
    global.fetch = fetchMock as never;
    const { service, warn } = build();

    await service.create('t1', createDto);

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(url).not.toContain(TOKEN);
    expect(init.body.get('access_token')).toBe(TOKEN); // it travels in the request body only
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
  });
});
