import { fetchPublicFile, UnsafePageUrlError } from './public-page-fetch';

describe('fetchPublicFile', () => {
  const resolver = async (host: string) => (host === 'cdn.example.com' ? ['93.184.216.34'] : host === 'rebind.example.com' ? ['10.0.0.9'] : ['127.0.0.1']);

  it.each(['http://127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/latest', 'http://redis:6379/', 'file:///etc/passwd', 'http://rebind.example.com/x'])('refuses %s before any request', async (url) => {
    const client = { get: jest.fn() };
    await expect(fetchPublicFile(url, { resolver, client: client as never })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('returns the bytes and content type of a public file', async () => {
    const client = { get: jest.fn().mockResolvedValue({ status: 200, data: new TextEncoder().encode('hello').buffer, headers: { 'content-type': 'image/png' } }) };
    const out = await fetchPublicFile('https://cdn.example.com/a.png', { resolver, client: client as never });
    expect(out.buffer.toString()).toBe('hello');
    expect(out.contentType).toBe('image/png');
  });

  it('validates a redirect target as well: a public URL that redirects to an internal one is refused', async () => {
    const client = { get: jest.fn().mockResolvedValueOnce({ status: 302, data: new ArrayBuffer(0), headers: { location: 'http://127.0.0.1:3001/secret' } }) };
    await expect(fetchPublicFile('https://cdn.example.com/a.png', { resolver, client: client as never })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(client.get).toHaveBeenCalledTimes(1);
  });
});
