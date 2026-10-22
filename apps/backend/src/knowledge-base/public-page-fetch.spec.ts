import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { fetchPublicPage, guardedLookup, PageFetchError, UnsafePageUrlError } from './public-page-fetch';

const PUBLIC_IP = '93.184.216.34';
const publicResolver = async () => [PUBLIC_IP];
const html = (extra = {}) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, data: '<html><title>Hi</title>hello</html>', ...extra });
const redirect = (location: string, status = 302) => ({ status, headers: { location }, data: '' });

function clientReturning(...responses: unknown[]) {
  const get = jest.fn();
  for (const r of responses) get.mockResolvedValueOnce(r);
  return { get } as never as { get: jest.Mock };
}

describe('fetchPublicPage: addresses that must never be requested', () => {
  it.each([
    'http://localhost/', 'http://LOCALHOST:80/', 'http://foo.localhost/', 'http://db.internal/', 'http://printer.local/',
    'http://127.0.0.1/', 'http://127.1/', 'http://0.0.0.0/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/',
    'http://[::1]/', 'http://[::]/', 'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:10.0.0.1]/',
    'http://[::7f00:1]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:7f00:1::]/',
    // alternate spellings of 127.0.0.1 and 169.254.169.254: the URL parser normalizes them before the check
    'http://2130706433/', 'http://0x7f000001/', 'http://0x7f.0.0.1/', 'http://017700000001/', 'http://0177.0.0.1/', 'http://2852039166/',
  ])('refuses %s without making any request', async (target) => {
    const client = clientReturning(html());
    await expect(fetchPublicPage(target, { resolver: publicResolver, client })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('refuses a public-looking name that resolves to an internal address (DNS pointing inward)', async () => {
    const client = clientReturning(html());
    await expect(fetchPublicPage('https://shop.example.com/', { resolver: async () => ['10.1.2.3'], client })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('refuses when ANY of several resolved addresses is internal', async () => {
    const client = clientReturning(html());
    await expect(fetchPublicPage('https://shop.example.com/', { resolver: async () => [PUBLIC_IP, '127.0.0.1'], client })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(client.get).not.toHaveBeenCalled();
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/', 'javascript:alert(1)', 'not a url', '', 'https://user:pass@example.com/', 'https://example.com:8080/', 'https://example.com:22/', 'https://example.com:5432/'])(
    'refuses %p (scheme, credentials or non-web port)', async (target) => {
      const client = clientReturning(html());
      await expect(fetchPublicPage(target, { resolver: publicResolver, client })).rejects.toBeInstanceOf(UnsafePageUrlError);
      expect(client.get).not.toHaveBeenCalled();
    },
  );

  it('the refusal message never repeats the address or says anything about the network', async () => {
    const err = await fetchPublicPage('http://169.254.169.254/latest/', { resolver: publicResolver, client: clientReturning(html()) }).catch((e: Error) => e);
    expect((err as Error).message).toBe('That address cannot be used. Enter the address of a public website.');
    expect((err as Error).message).not.toMatch(/169|private|metadata|resolve/i);
  });
});

describe('fetchPublicPage: redirects are revalidated hop by hop', () => {
  it('refuses a public page that redirects to the cloud metadata address, after exactly one request', async () => {
    const client = clientReturning(redirect('http://169.254.169.254/latest/meta-data/'), html());
    await expect(fetchPublicPage('https://shop.example.com/', { resolver: publicResolver, client })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it.each(['http://localhost/admin', 'http://[::1]/', '/\\\\127.0.0.1/', 'http://2130706433/'])('refuses a redirect to %s mid-chain', async (location) => {
    const client = clientReturning(redirect('https://shop.example.com/step2'), redirect(location), html());
    await expect(fetchPublicPage('https://shop.example.com/', { resolver: async (h) => (h === 'shop.example.com' ? [PUBLIC_IP] : ['127.0.0.1']), client })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect to a host that only resolves inward', async () => {
    const resolver = async (h: string) => (h === 'evil.example.net' ? ['192.168.0.9'] : [PUBLIC_IP]);
    const client = clientReturning(redirect('https://evil.example.net/'), html());
    await expect(fetchPublicPage('https://shop.example.com/', { resolver, client })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a non-web scheme', async () => {
    const client = clientReturning(redirect('file:///etc/passwd'), html());
    await expect(fetchPublicPage('https://shop.example.com/', { resolver: publicResolver, client })).rejects.toBeInstanceOf(UnsafePageUrlError);
  });

  it('follows legitimate public redirects (http to https, www, relative paths) and returns the final page', async () => {
    const client = clientReturning(redirect('https://shop.example.com/', 301), redirect('/home'), html());
    const result = await fetchPublicPage('http://shop.example.com/', { resolver: publicResolver, client });
    expect(result.finalUrl).toBe('https://shop.example.com/home');
    expect(result.html).toContain('hello');
    expect(client.get).toHaveBeenCalledTimes(3);
  });

  it('never lets the HTTP client follow redirects itself, and ignores proxy settings', async () => {
    const client = clientReturning(html());
    await fetchPublicPage('https://shop.example.com/', { resolver: publicResolver, client });
    expect(client.get).toHaveBeenCalledWith('https://shop.example.com/', expect.objectContaining({ maxRedirects: 0, proxy: false, maxContentLength: 500_000 }));
  });

  it('stops after too many redirects', async () => {
    const get = jest.fn().mockResolvedValue(redirect('https://shop.example.com/again'));
    await expect(fetchPublicPage('https://shop.example.com/', { resolver: publicResolver, client: { get } as never })).rejects.toBeInstanceOf(PageFetchError);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('treats a redirect with no location as a failed fetch', async () => {
    await expect(fetchPublicPage('https://shop.example.com/', { resolver: publicResolver, client: clientReturning({ status: 302, headers: {}, data: '' }) })).rejects.toBeInstanceOf(PageFetchError);
  });
});

describe('fetchPublicPage: legitimate public sites keep working', () => {
  it.each(['https://example.com/', 'http://example.com/about', 'https://example.com:443/', 'http://example.com:80/x?y=1#z', 'https://www.example.co.uk/shop'])('fetches %s', async (target) => {
    const result = await fetchPublicPage(target, { resolver: publicResolver, client: clientReturning(html()) });
    expect(result.html).toContain('hello');
  });

  it('accepts a public IPv6 literal and plain-text pages', async () => {
    const client = clientReturning(html({ headers: { 'content-type': 'text/plain' } }));
    await expect(fetchPublicPage('https://[2606:4700:4700::1111]/', { client })).resolves.toMatchObject({ html: expect.any(String) });
  });

  it('rejects non-page content types and non-text bodies', async () => {
    await expect(fetchPublicPage('https://example.com/f.pdf', { resolver: publicResolver, client: clientReturning(html({ headers: { 'content-type': 'application/pdf' } })) })).rejects.toBeInstanceOf(PageFetchError);
    await expect(fetchPublicPage('https://example.com/', { resolver: publicResolver, client: clientReturning(html({ data: { a: 1 } })) })).rejects.toBeInstanceOf(PageFetchError);
  });

  it('turns a network failure into a PageFetchError that carries no address', async () => {
    const get = jest.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:80'), { code: 'ECONNREFUSED' }));
    const err = await fetchPublicPage('https://example.com/', { resolver: publicResolver, client: { get } as never }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(PageFetchError);
    expect((err as Error).message).not.toContain('10.0.0.9');
  });
});

describe('guardedLookup (connect-time check)', () => {
  const run = (resolver: () => Promise<string[]>, options: object | number = {}) =>
    new Promise<{ err: Error | null; address?: unknown }>((resolve) => guardedLookup(resolver)('h.example', options as never, (err, address) => resolve({ err, address })));

  it('returns a public address', async () => {
    expect(await run(async () => [PUBLIC_IP])).toMatchObject({ err: null, address: PUBLIC_IP });
    expect(await run(async () => [PUBLIC_IP, '2606:4700:4700::1111'], { all: true })).toMatchObject({ err: null, address: [{ address: PUBLIC_IP, family: 4 }, { address: '2606:4700:4700::1111', family: 6 }] });
  });
  it.each([['127.0.0.1'], ['169.254.169.254'], ['::1'], ['::ffff:10.0.0.1']])('rejects %s', async (ip) => {
    expect((await run(async () => [ip])).err).toBeInstanceOf(UnsafePageUrlError);
  });
  it('rejects when one of several answers is internal, and when there is no answer', async () => {
    expect((await run(async () => [PUBLIC_IP, '10.0.0.1'], { all: true })).err).toBeInstanceOf(UnsafePageUrlError);
    expect((await run(async () => [])).err).toBeInstanceOf(UnsafePageUrlError);
  });
});

describe('fetchPublicPage with the real HTTP client (nothing is mocked below the resolver)', () => {
  let server: Server;
  let hits = 0;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => { hits++; res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>internal secret</html>'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => { hits = 0; });

  it('never connects to a local server given by IP', async () => {
    await expect(fetchPublicPage(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(hits).toBe(0);
  });

  it('DNS rebinding: a name that is public when checked and internal when connected is refused at connect time', async () => {
    // First lookup (validation) answers with a public address, every later lookup (the connection) with loopback.
    let calls = 0;
    const rebinding = async () => (++calls === 1 ? [PUBLIC_IP] : ['127.0.0.1']);
    await expect(fetchPublicPage('http://rebind.example/', { resolver: rebinding })).rejects.toBeInstanceOf(UnsafePageUrlError);
    expect(calls).toBeGreaterThanOrEqual(2); // proves the connection did its own lookup instead of reusing the check's
    expect(hits).toBe(0);
  });
});
