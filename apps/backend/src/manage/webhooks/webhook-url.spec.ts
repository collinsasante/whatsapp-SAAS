import { assertPublicWebhookUrl, isPrivateAddress } from '@whatsapp-platform/shared-utils';

describe('webhook URL SSRF guard', () => {
  const env = process.env['WEBHOOK_ALLOW_PRIVATE_URLS'];
  afterEach(() => {
    process.env['WEBHOOK_ALLOW_PRIVATE_URLS'] = env;
  });

  it.each(['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    'treats %s as private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(['8.8.8.8', '104.21.92.134', '2606:4700::6810:5c86'])('treats %s as public', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );

  it('rejects internal targets, odd schemes and embedded credentials', async () => {
    delete process.env['WEBHOOK_ALLOW_PRIVATE_URLS'];
    await expect(assertPublicWebhookUrl('http://127.0.0.1:3002/internal/emit')).rejects.toThrow('public');
    await expect(assertPublicWebhookUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('public');
    await expect(assertPublicWebhookUrl('http://[::1]:8080/')).rejects.toThrow('public');
    await expect(assertPublicWebhookUrl('file:///etc/passwd')).rejects.toThrow('http');
    await expect(assertPublicWebhookUrl('https://user:pass@example.com/')).rejects.toThrow('credentials');
    await expect(assertPublicWebhookUrl('not a url')).rejects.toThrow('valid');
  });

  it('accepts a public IP and allows private targets only when explicitly enabled', async () => {
    delete process.env['WEBHOOK_ALLOW_PRIVATE_URLS'];
    await expect(assertPublicWebhookUrl('https://8.8.8.8/hook')).resolves.toBeUndefined();
    process.env['WEBHOOK_ALLOW_PRIVATE_URLS'] = 'true';
    await expect(assertPublicWebhookUrl('http://127.0.0.1:8001/hook')).resolves.toBeUndefined();
  });
});
