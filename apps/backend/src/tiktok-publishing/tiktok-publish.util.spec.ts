import { describeRefusal, fetchPublishStatus, hasPublishScope, initDirectPost, planChunks, uploadVideo } from './tiktok-publish.util';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const TOKEN = 'TOKEN-0123456789-0123456789-0123456789-ABCDEF';

describe('planChunks', () => {
  const MB = 1024 * 1024;
  it.each([1000, 5 * MB, 7 * MB, 64 * MB])('sends %d bytes as one chunk', (size) => expect(planChunks(size)).toEqual({ chunkSize: size, total: 1 }));
  it('uses 10 MB chunks above 64 MB, the remainder folded into the last, never zero chunks', () => {
    expect(planChunks(75 * MB)).toEqual({ chunkSize: 10 * MB, total: 7 });
    expect(planChunks(65 * MB)).toEqual({ chunkSize: 10 * MB, total: 6 });
  });
});

describe('hasPublishScope', () => {
  it.each([['user.info.basic,video.publish', true], ['video.publish', true], ['user.info.basic', false], ['video.publisher', false], [undefined, false], [5, false]])('%s -> %s', (s, ok) => {
    expect(hasPublishScope(s)).toBe(ok);
  });
});

describe('initDirectPost', () => {
  const args = { caption: 'hi', privacyLevel: 'SELF_ONLY' as const, videoSize: 100 };
  it('returns the publish id and upload url', async () => {
    const f = jest.fn().mockResolvedValue(json({ data: { publish_id: 'p1', upload_url: 'https://u' }, error: { code: 'ok' } }));
    expect(await initDirectPost(f, TOKEN, args)).toEqual({ kind: 'ok', publishId: 'p1', uploadUrl: 'https://u' });
    expect(f.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
  it('treats "ok" without ids as unknown rather than guessing', async () => {
    expect(await initDirectPost(jest.fn().mockResolvedValue(json({ data: {}, error: { code: 'ok' } })), TOKEN, args)).toEqual({ kind: 'unknown' });
  });
  it.each([['rate_limit_exceeded', true, false], ['access_token_invalid', false, true], ['spam_risk_too_many_posts', false, false]])('refusal %s', async (code, retry, reconnect) => {
    const r = await initDirectPost(jest.fn().mockResolvedValue(json({ error: { code, message: 'm' } }, 400)), TOKEN, args);
    expect(r).toMatchObject({ kind: 'refused', code, retry, reconnect });
  });
  it('says not-sent only when the connection could not be opened, unknown for a timeout or reset', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    expect(await initDirectPost(jest.fn().mockRejectedValue(refused), TOKEN, args)).toEqual({ kind: 'not-sent' });
    expect(await initDirectPost(jest.fn().mockRejectedValue(reset), TOKEN, args)).toEqual({ kind: 'unknown' });
    expect(await initDirectPost(jest.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })), TOKEN, args)).toEqual({ kind: 'unknown' });
  });
  it('never echoes a token-like string from TikTok\'s message', async () => {
    const r = await initDirectPost(jest.fn().mockResolvedValue(json({ error: { code: 'x', message: `bad ${TOKEN}` } }, 400)), TOKEN, args);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('uploadVideo', () => {
  const MB = 1024 * 1024;
  const video = Buffer.alloc(75 * MB, 1);
  it('sends contiguous ranges that cover the file', async () => {
    const f = jest.fn().mockResolvedValue(new Response(null, { status: 206 }));
    expect(await uploadVideo(f, 'https://u', video, 'video/mp4')).toBeNull();
    const ranges = f.mock.calls.map((c) => c[1].headers['Content-Range'] as string);
    expect(ranges).toHaveLength(7);
    expect(ranges[0]).toBe(`bytes 0-${10 * MB - 1}/${video.length}`);
    expect(ranges[6]).toBe(`bytes ${60 * MB}-${video.length - 1}/${video.length}`);
  });
  it('retries a failed chunk and succeeds', async () => {
    const f = jest.fn().mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValue(new Response(null, { status: 201 }));
    expect(await uploadVideo(f, 'https://u', Buffer.alloc(100), 'video/mp4', async () => undefined)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('reports failure after three attempts', async () => {
    const f = jest.fn().mockResolvedValue(new Response(null, { status: 500 }));
    expect(await uploadVideo(f, 'https://u', Buffer.alloc(100), 'video/mp4', async () => undefined)).toMatch(/chunk 1\/1/);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe('fetchPublishStatus', () => {
  const st = (data: object, status = 200) => jest.fn().mockResolvedValue(json({ data, error: { code: 'ok' } }, status));
  it('maps each TikTok state', async () => {
    expect(await fetchPublishStatus(st({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['77'] }), TOKEN, 'p')).toEqual({ kind: 'published', postId: '77' });
    expect(await fetchPublishStatus(st({ status: 'FAILED', fail_reason: 'bad_video' }), TOKEN, 'p')).toEqual({ kind: 'failed', reason: 'bad_video' });
    expect(await fetchPublishStatus(st({ status: 'PROCESSING_UPLOAD' }), TOKEN, 'p')).toMatchObject({ kind: 'processing' });
    expect(await fetchPublishStatus(st({ status: 'WHAT' }), TOKEN, 'p')).toEqual({ kind: 'unavailable' });
  });
  it('flags a rejected token and tolerates a dead network', async () => {
    expect(await fetchPublishStatus(jest.fn().mockResolvedValue(json({ error: { code: 'access_token_invalid' } }, 401)), TOKEN, 'p')).toEqual({ kind: 'reconnect' });
    expect(await fetchPublishStatus(jest.fn().mockRejectedValue(new Error('down')), TOKEN, 'p')).toEqual({ kind: 'unavailable' });
  });
});

describe('describeRefusal', () => {
  it('explains the unaudited-app limit in plain words', () => expect(describeRefusal('unaudited_client_can_only_post_to_private_accounts', '')).toMatch(/Only me/));
});
