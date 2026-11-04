import { telegramCall, telegramDownload, TELEGRAM_MAX_DOWNLOAD_BYTES } from './telegram-api.util';

const TOKEN = '999:SECRET-TOKEN';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('telegramCall', () => {
  it('returns the result on success and addresses the bot method', async () => {
    const fetchFn = jest.fn().mockResolvedValue(json({ ok: true, result: { id: 1 } }));
    expect(await telegramCall(TOKEN, 'getMe', {}, { fetchFn })).toMatchObject({ ok: true, result: { id: 1 } });
    expect(String(fetchFn.mock.calls[0][0])).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
  });
  it('maps an API error without throwing', async () => {
    const r = await telegramCall(TOKEN, 'sendMessage', {}, { fetchFn: jest.fn().mockResolvedValue(json({ ok: false, error_code: 403, description: 'Forbidden' }, 403)) });
    expect(r).toMatchObject({ ok: false, errorCode: 403, description: 'Forbidden' });
  });
  it('retries once on a short 429 and reports success', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } }, 429))
      .mockResolvedValueOnce(json({ ok: true, result: true }));
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    expect(await telegramCall(TOKEN, 'sendMessage', {}, { fetchFn, sleepFn })).toMatchObject({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(1200); // retry_after plus a 200 ms margin
  });
  it('does not wait for a long rate limit', async () => {
    const fetchFn = jest.fn().mockResolvedValue(json({ ok: false, error_code: 429, parameters: { retry_after: 60 } }, 429));
    const r = await telegramCall(TOKEN, 'sendMessage', {}, { fetchFn, sleepFn: jest.fn() });
    expect(r).toMatchObject({ ok: false, errorCode: 429, retryAfter: 60 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('maps a network failure to code 0 and never exposes the token', async () => {
    const r = await telegramCall(TOKEN, 'sendMessage', {}, { fetchFn: jest.fn().mockRejectedValue(new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/sendMessage`)) });
    expect(r).toMatchObject({ ok: false, errorCode: 0 });
    expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN');
  });
});

describe('telegramDownload', () => {
  it('returns the bytes and mime type', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(Buffer.from('abc'), { status: 200, headers: { 'content-type': 'image/png' } }));
    const r = await telegramDownload(TOKEN, 'photos/a.png', { fetchFn } as never);
    expect(r).toMatchObject({ mimeType: 'image/png' });
    expect('buffer' in r && r.buffer.toString()).toBe('abc');
  });
  it('refuses files over the Bot API limit and never leaks the token in the error', async () => {
    const big = new Response(Buffer.alloc(8), { status: 200, headers: { 'content-length': String(TELEGRAM_MAX_DOWNLOAD_BYTES + 1) } });
    const r = await telegramDownload(TOKEN, 'x', { fetchFn: jest.fn().mockResolvedValue(big) } as never);
    expect(r).toHaveProperty('error');
    expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN');
  });
  it('maps an HTTP failure to an error', async () => {
    const r = await telegramDownload(TOKEN, 'x', { fetchFn: jest.fn().mockResolvedValue(new Response('no', { status: 404 })) } as never);
    expect(r).toHaveProperty('error');
  });
});
