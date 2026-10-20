import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@whatsapp-platform/shared-types';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

// A reversible stand-in for the real AES service, so "stored value is not the plaintext" is observable.
const crypto = {
  encrypt: jest.fn((v: string) => `enc:v1:${Buffer.from(v).toString('base64')}`),
  decrypt: jest.fn((v: string | null) => (v?.startsWith('enc:v1:') ? Buffer.from(v.slice(7), 'base64').toString() : (v ?? ''))),
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'w1', tenantId: 't1', name: 'CRM', url: 'https://example.com/hook', events: ['message.received'],
    secret: null, headers: null, isActive: true, lastTriggeredAt: null, failureCount: 0, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

function build(existing: ReturnType<typeof row> | null = null) {
  const prisma = {
    webhook: {
      findMany: jest.fn().mockResolvedValue(existing ? [existing] : []),
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(row({ ...data, id: 'new' }))),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new WebhooksService(prisma as any, crypto as any, audit as any, config as any);
  // The default test host must pass the SSRF check without real DNS.
  jest.spyOn(require('./webhook-url.util'), 'assertSafeWebhookUrl');
  return { service, prisma, audit, config };
}

const publicUrl = 'https://93.184.216.34/hook';

describe('WebhooksService.create -- secret generation', () => {
  it('generates a strong secret on request, stores it encrypted, and returns it exactly once', async () => {
    const { service, prisma } = build();
    const out = await service.create('t1', { name: 'CRM', url: publicUrl, generateSecret: true }, 'u1');
    expect(out.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const stored = prisma.webhook.create.mock.calls[0][0].data.secret as string;
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain(out.secret!);
    expect(out.hasSecret).toBe(true);
  });

  it('preserves the manual-secret workflow', async () => {
    const { service, prisma } = build();
    const out = await service.create('t1', { name: 'CRM', url: publicUrl, secret: 'my-own-secret-12345' }, 'u1');
    expect(out.secret).toBe('my-own-secret-12345');
    expect(crypto.decrypt(prisma.webhook.create.mock.calls[0][0].data.secret)).toBe('my-own-secret-12345');
  });

  it('generateSecret wins over a supplied secret', async () => {
    const { service } = build();
    const out = await service.create('t1', { name: 'CRM', url: publicUrl, generateSecret: true, secret: 'my-own-secret-12345' }, 'u1');
    expect(out.secret).toMatch(/^whsec_/);
  });

  it('generates a secret by default when the caller asks for nothing (what the dashboard relies on)', async () => {
    const { service, prisma } = build();
    const out = await service.create('t1', { name: 'CRM', url: publicUrl }, 'u1');
    expect(out.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(out.hasSecret).toBe(true);
    expect((prisma.webhook.create.mock.calls[0][0].data.secret as string).startsWith('enc:v1:')).toBe(true);
  });

  it('only an explicit generateSecret=false (API clients) creates an unsigned webhook', async () => {
    const { service, prisma } = build();
    const out = await service.create('t1', { name: 'CRM', url: publicUrl, generateSecret: false }, 'u1');
    expect(out.secret).toBeUndefined();
    expect(out.hasSecret).toBe(false);
    expect(prisma.webhook.create.mock.calls[0][0].data.secret).toBeUndefined();
  });

  it('two webhooks never share a generated secret', async () => {
    const { service } = build();
    const a = await service.create('t1', { name: 'A', url: publicUrl }, 'u1');
    const b = await service.create('t1', { name: 'B', url: publicUrl }, 'u1');
    expect(a.secret).not.toBe(b.secret);
  });

  it.each(['short', 'has spaces in the secret value', 'x'.repeat(300)])('rejects an invalid manual secret %#', async (secret) => {
    const { service, prisma } = build();
    await expect(service.create('t1', { name: 'CRM', url: publicUrl, secret }, 'u1')).rejects.toThrow(BadRequestException);
    expect(prisma.webhook.create).not.toHaveBeenCalled();
  });

  it.each(['http://127.0.0.1/x', 'http://169.254.169.254/latest', 'http://localhost:3001', 'ftp://x.test/a'])('rejects the unsafe URL %s', async (url) => {
    const { service, prisma } = build();
    await expect(service.create('t1', { name: 'CRM', url }, 'u1')).rejects.toThrow(BadRequestException);
    expect(prisma.webhook.create).not.toHaveBeenCalled();
  });

  it('creates inside the caller tenant only', async () => {
    const { service, prisma } = build();
    await service.create('tenant-A', { name: 'CRM', url: publicUrl }, 'u1');
    expect(prisma.webhook.create.mock.calls[0][0].data.tenantId).toBe('tenant-A');
  });
});

describe('secrets are never readable afterwards', () => {
  const stored = row({ secret: 'enc:v1:c2VjcmV0LXZhbHVl', headers: { Authorization: 'Bearer top-secret-token' } });

  it('list returns neither the secret nor header values', async () => {
    const { service } = build(stored);
    const [item] = await service.list('t1');
    expect(JSON.stringify(item)).not.toContain('enc:v1');
    expect(JSON.stringify(item)).not.toContain('top-secret-token');
    expect(item).toMatchObject({ hasSecret: true, headerNames: ['Authorization'] });
    expect(item).not.toHaveProperty('secret');
    expect(item).not.toHaveProperty('headers');
  });

  it('update does not echo the secret, even when it just replaced it', async () => {
    const { service, prisma } = build(stored);
    prisma.webhook.findFirst.mockResolvedValue({ ...stored, secret: crypto.encrypt('brand-new-secret-123') });
    const out = await service.update('w1', 't1', { secret: 'brand-new-secret-123' }, 'u1');
    expect(JSON.stringify(out)).not.toContain('brand-new-secret-123');
    expect(out).not.toHaveProperty('secret');
  });

  it('the audit trail never contains a secret', async () => {
    const { service, audit } = build(stored);
    await service.create('t1', { name: 'CRM', url: publicUrl, generateSecret: true, headers: { 'X-Token': 'zzzz-header-value' } }, 'u1');
    await service.rotateSecret('w1', 't1', 'u1');
    await service.update('w1', 't1', { secret: 'replacement-secret-123' }, 'u1');
    const logged = JSON.stringify(audit.log.mock.calls);
    expect(logged).not.toMatch(/whsec_/);
    expect(logged).not.toContain('replacement-secret-123');
    expect(logged).not.toContain('zzzz-header-value');
  });
});

describe('rotation is explicit, never silent', () => {
  it('editing other fields leaves the stored secret untouched', async () => {
    const { service, prisma } = build(row({ secret: 'enc:v1:abc' }));
    await service.update('w1', 't1', { name: 'Renamed', isActive: false }, 'u1');
    const data = prisma.webhook.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('secret');
    expect(data).toMatchObject({ name: 'Renamed', isActive: false });
  });

  it('rotateSecret writes a new encrypted secret, returns it once, and records the rotation', async () => {
    const { service, prisma, audit } = build(row({ secret: 'enc:v1:old' }));
    const out = await service.rotateSecret('w1', 't1', 'u1');
    expect(out.secret).toMatch(/^whsec_/);
    const written = prisma.webhook.updateMany.mock.calls[0][0];
    expect(written.where).toEqual({ id: 'w1', tenantId: 't1' });
    expect(written.data.secret).not.toBe('enc:v1:old');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ resource: 'webhook', resourceId: 'w1', metadata: { secretRotated: true } }));
  });
});

describe('tenant isolation', () => {
  it.each([
    ['update', (s: WebhooksService) => s.update('w1', 'other-tenant', { name: 'x' }, 'u')],
    ['rotateSecret', (s: WebhooksService) => s.rotateSecret('w1', 'other-tenant', 'u')],
    ['remove', (s: WebhooksService) => s.remove('w1', 'other-tenant', 'u')],
    ['test', (s: WebhooksService) => s.test('w1', 'other-tenant')],
  ])('%s cannot touch another tenant\'s webhook', async (_n, run) => {
    const { service, prisma } = build(null); // findFirst scoped by tenant finds nothing
    await expect(run(service)).rejects.toThrow(NotFoundException);
    expect(prisma.webhook.findFirst).toHaveBeenCalledWith({ where: { id: 'w1', tenantId: 'other-tenant' } });
    expect(prisma.webhook.updateMany).not.toHaveBeenCalled();
    expect(prisma.webhook.deleteMany).not.toHaveBeenCalled();
  });

  it('list is scoped to the caller tenant', async () => {
    const { service, prisma } = build();
    await service.list('tenant-A');
    expect(prisma.webhook.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-A' });
  });
});

describe('delivery stays compatible with existing consumers', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('sends the decrypted secret in the unchanged X-Webhook-Secret header, without following redirects', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;
    const { service } = build(row({ url: publicUrl, secret: crypto.encrypt('consumer-secret-123456') }));
    expect(await service.test('w1', 't1')).toEqual({ success: true, status: 200 });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['X-Webhook-Secret']).toBe('consumer-secret-123456');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeDefined();
  });

  it('keeps working for a legacy webhook whose secret was stored as plaintext', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as never;
    const { service } = build(row({ url: publicUrl, secret: 'legacy-plaintext-secret' }));
    await service.test('w1', 't1');
    expect(fetchMock.mock.calls[0][1].headers['X-Webhook-Secret']).toBe('legacy-plaintext-secret');
  });

  it('does not send a header when there is no secret', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;
    const { service } = build(row({ url: publicUrl }));
    await service.test('w1', 't1');
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Webhook-Secret');
  });

  it('refuses to call a URL that has become unsafe since it was saved, without sending anything', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    const { service } = build(row({ url: 'http://169.254.169.254/latest/meta-data' }));
    const out = await service.test('w1', 't1');
    expect(out.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a clear error, without leaking, when a stored encrypted secret cannot be opened', async () => {
    global.fetch = jest.fn() as never;
    const { service } = build(row({ url: publicUrl, secret: 'enc:v1:garbage' }));
    crypto.decrypt.mockImplementationOnce(() => { throw new Error('no key configured'); });
    const out = await service.test('w1', 't1');
    expect(out).toEqual({ success: false, error: expect.stringContaining('Regenerate') });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('WebhooksController authorization', () => {
  const reflector = new Reflector();
  const rolesOf = (method: keyof WebhooksController) => reflector.get<UserRole[]>(ROLES_KEY, WebhooksController.prototype[method]);

  it.each(['create', 'update', 'rotateSecret', 'remove', 'test'] as const)('%s requires an admin', (m) => {
    expect(rolesOf(m)).toEqual([UserRole.ADMIN]);
  });
  it('list is open to signed-in members (it exposes no secrets)', () => {
    expect(rolesOf('list')).toBeUndefined();
  });
});
