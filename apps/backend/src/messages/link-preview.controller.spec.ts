import { LinkPreviewController } from './link-preview.controller';

/** The preview fetch runs on the server for any logged-in user, so it must never be usable to reach internal services (SSRF). */
describe('LinkPreviewController SSRF protection', () => {
  const controller = new LinkPreviewController();
  const empty = (url: string) => ({ url, title: null, description: null, image: null, siteName: null });

  it.each([
    'http://127.0.0.1:3001/api/v1/health',
    'http://localhost:6379/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://0.0.0.0/',
    'file:///etc/passwd',
    'ftp://example.com/x',
  ])('returns an empty preview for %s without fetching it', async (url) => {
    await expect(controller.preview(url)).resolves.toEqual(empty(url));
  });

  it('rejects a missing or malformed url without fetching anything', async () => {
    await expect(controller.preview('')).resolves.toEqual({ error: 'missing url' });
    await expect(controller.preview('not a url')).resolves.toEqual({ error: 'invalid url' });
  });
});
