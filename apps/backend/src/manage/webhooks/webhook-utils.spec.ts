import { generateWebhookSecret, isAcceptableManualSecret, WEBHOOK_SECRET_PREFIX } from './webhook-secret.util';
import { assertSafeWebhookUrl, isBlockedIp, UnsafeWebhookUrlError } from './webhook-url.util';
import { validateCustomHeaders } from './webhook-headers.util';

describe('generateWebhookSecret', () => {
  it('has the prefix and carries 256 bits of randomness', () => {
    const s = generateWebhookSecret();
    expect(s.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    const body = s.slice(WEBHOOK_SECRET_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(body, 'base64url')).toHaveLength(32);
  });
  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 2000 }, generateWebhookSecret));
    expect(seen.size).toBe(2000);
  });
  it('uses all byte values over many samples (not a low-entropy generator)', () => {
    const bytes = new Set<number>();
    for (let i = 0; i < 200; i++) for (const b of Buffer.from(generateWebhookSecret().slice(WEBHOOK_SECRET_PREFIX.length), 'base64url')) bytes.add(b);
    expect(bytes.size).toBeGreaterThan(240);
  });
  it('is accepted by the manual-secret rule too', () => {
    expect(isAcceptableManualSecret(generateWebhookSecret())).toBe(true);
  });
});

describe('isAcceptableManualSecret', () => {
  it.each([['short', false], ['a'.repeat(15), false], ['a'.repeat(16), true], ['a'.repeat(256), true], ['a'.repeat(257), false],
    ['has a space in it 1234', false], ['line\nbreak1234567890', false], ['tab\there1234567890', false], ['ünicode-secret-123456', false],
    ['Valid_Secret-12345678', true]])('%j -> %s', (v, ok) => expect(isAcceptableManualSecret(v)).toBe(ok));
});

describe('assertSafeWebhookUrl', () => {
  const publicResolver = async () => ['93.184.216.34'];
  it('accepts a public https URL', async () => {
    await expect(assertSafeWebhookUrl('https://example.com/hook', { resolver: publicResolver })).resolves.toBeInstanceOf(URL);
  });
  it.each([
    'ftp://example.com/x', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url', '',
    'https://user:pass@example.com/x', 'http://localhost:3001/api', 'http://app.localhost/x', 'http://db.internal/x', 'http://printer.local/x',
    'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://169.254.169.254/latest/meta-data', 'http://192.168.1.1/x', 'http://172.16.0.1/x',
    'http://[::1]/x', 'http://[fd00::1]/x', 'http://[::ffff:10.0.0.1]/x', 'http://[::ffff:7f00:1]/x', 'http://[::ffff:a9fe:a9fe]/x', 'http://[64:ff9b::a00:1]/x', 'http://0.0.0.0/x', 'http://100.64.0.1/x',
  ])('rejects %j', async (u) => {
    await expect(assertSafeWebhookUrl(u, { resolver: publicResolver })).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });
  it('rejects a public-looking host that resolves to a private address (DNS pointing inward)', async () => {
    await expect(assertSafeWebhookUrl('https://evil.example.com/x', { resolver: async () => ['93.184.216.34', '10.0.0.7'] })).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });
  it('rejects a host that does not resolve', async () => {
    await expect(assertSafeWebhookUrl('https://nope.example.com/x', { resolver: async () => { throw new Error('ENOTFOUND'); } })).rejects.toThrow('could not resolve');
  });
  it('allows private addresses only when explicitly enabled, but still refuses credentials in the URL', async () => {
    await expect(assertSafeWebhookUrl('http://10.0.0.5/x', { allowPrivate: true })).resolves.toBeDefined();
    await expect(assertSafeWebhookUrl('http://u:p@10.0.0.5/x', { allowPrivate: true })).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });
});

describe('isBlockedIp', () => {
  it.each(['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808'])('%s is public', (ip) => expect(isBlockedIp(ip)).toBe(false));
  it.each(['127.0.0.1', '10.1.2.3', '172.31.255.255', '192.168.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'not-an-ip'])('%s is blocked', (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each([
    '::7f00:1', '::a00:1', '0:0:0:0:0:0:7f00:1', '::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1', '2002:7f00:1::1', '2002:a9fe:a9fe::1', '2001::1', '2001:db8::1', 'fec0::1', 'ff02::1', '100::1',
  ])('%s is blocked (IPv6 forms that carry or reach an internal IPv4 address)', (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(['2001:4860:4860::8888', '2a00:1450:4001:81b::200e', '2002:808:808::1', '::ffff:5db8:d822'])('%s is public', (ip) => expect(isBlockedIp(ip)).toBe(false));
  it('does not block the public ranges just outside the private ones', () => {
    for (const ip of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.167.1.1', '100.63.0.1', '100.128.0.1']) expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('validateCustomHeaders', () => {
  it('accepts normal headers and none', () => {
    expect(validateCustomHeaders(undefined)).toBeNull();
    expect(validateCustomHeaders({ Authorization: 'Bearer abc', 'X-Api-Key': 'k' })).toBeNull();
  });
  it.each([
    [{ 'bad name': 'v' }], [{ Host: 'evil' }], [{ 'content-length': '1' }], [{ 'X-Webhook-Secret': 'override' }],
    [{ Good: 'line\r\nInjected: 1' }], [{ Good: '' }], [{ Good: 'x'.repeat(1025) }],
    [Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`H${i}`, 'v']))],
  ])('rejects %j', (h) => expect(validateCustomHeaders(h as Record<string, string>)).not.toBeNull());
});
