import { describeFailReason, describeRefusal, fetchPublishStatus, hasPublishScope, initDirectPost, planChunks, queryCreatorInfo, uploadVideo } from './tiktok-publish.util';

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

describe('uploadVideo (statuses as TikTok documents them)', () => {
  const MB = 1024 * 1024;
  const video = Buffer.alloc(75 * MB, 1);
  const seq = (...statuses: number[]) => { const f = jest.fn(); statuses.forEach((st) => f.mockResolvedValueOnce(new Response(null, { status: st }))); return f; };
  const nap = async () => undefined;
  it('sends contiguous ranges that cover the file, 206 for each partial chunk and 201 for the last', async () => {
    const f = seq(206, 206, 206, 206, 206, 206, 201);
    expect(await uploadVideo(f, 'https://u', video, 'video/mp4', nap)).toBeNull();
    const ranges = f.mock.calls.map((c) => c[1].headers['Content-Range'] as string);
    expect(ranges).toHaveLength(7);
    expect(ranges[0]).toBe(`bytes 0-${10 * MB - 1}/${video.length}`);
    expect(ranges[6]).toBe(`bytes ${60 * MB}-${video.length - 1}/${video.length}`);
    expect(f.mock.calls.every((c) => c[1].method === 'PUT')).toBe(true);
  });
  it('a small file goes in one request answered 201', async () => {
    const f = seq(201);
    expect(await uploadVideo(f, 'https://u', Buffer.alloc(100), 'video/mp4', nap)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('a final chunk answered 206 (TikTok does not consider the upload complete) is an error, not success', async () => {
    expect(await uploadVideo(seq(206), 'https://u', Buffer.alloc(100), 'video/mp4', nap)).toMatch(/unexpected status \(HTTP 206, expected 201\)/);
  });
  it('retries a 5xx on the same range and then succeeds', async () => {
    const f = seq(503, 201);
    expect(await uploadVideo(f, 'https://u', Buffer.alloc(100), 'video/mp4', nap)).toBeNull();
    expect(f.mock.calls.map((c) => c[1].headers['Content-Range'])).toEqual(['bytes 0-99/100', 'bytes 0-99/100']);
  });
  it('gives up after three attempts on repeated 5xx', async () => {
    const f = seq(500, 502, 503);
    expect(await uploadVideo(f, 'https://u', Buffer.alloc(100), 'video/mp4', nap)).toMatch(/chunk 1\/1/);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it.each([[403, /expired/], [404, /no longer recognises/], [416, /rejected chunk/], [400, /rejected chunk/]])('HTTP %s is not retried', async (status, msg) => {
    const f = seq(status as number, 201);
    expect(await uploadVideo(f, 'https://u', Buffer.alloc(100), 'video/mp4', nap)).toMatch(msg as RegExp);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('retries a network failure', async () => {
    const f = jest.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(new Response(null, { status: 201 }));
    expect(await uploadVideo(f, 'https://u', Buffer.alloc(100), 'video/mp4', nap)).toBeNull();
  });
});

describe('queryCreatorInfo', () => {
  const info = (data: object, error: object = { code: 'ok' }, status = 200) => jest.fn().mockResolvedValue(json({ data, error }, status));
  it('reads the allowed visibilities and the creator\'s settings', async () => {
    const f = info({ privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], comment_disabled: true, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 600 });
    expect(await queryCreatorInfo(f, TOKEN)).toEqual({ kind: 'ok', privacyOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], commentDisabled: true, duetDisabled: false, stitchDisabled: true, maxDurationSec: 600 });
    expect(f.mock.calls[0][0].toString()).toBe('https://open.tiktokapis.com/v2/post/publish/creator_info/query/');
  });
  it.each([['spam_risk_too_many_posts', 200, false, false], ['spam_risk_user_banned_from_posting', 200, false, false], ['reached_active_user_cap', 200, false, false], ['access_token_invalid', 401, false, true], ['scope_not_authorized', 401, false, true], ['rate_limit_exceeded', 429, true, false]])(
    'a posting limit or auth problem (%s, HTTP %s) is reported even when TikTok answers 200', async (code, status, retry, reconnect) => {
      expect(await queryCreatorInfo(info({}, { code, message: 'm' }, status as number), TOKEN)).toMatchObject({ kind: 'refused', code, retry, reconnect });
    });
  it('treats a lost answer as unavailable (the query changes nothing, so retrying is safe)', async () => {
    expect(await queryCreatorInfo(jest.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })), TOKEN)).toEqual({ kind: 'unavailable' });
    expect(await queryCreatorInfo(jest.fn().mockResolvedValue(new Response('<html>', { status: 502 })), TOKEN)).toEqual({ kind: 'unavailable' });
  });
});

describe('initDirectPost body (documented fields)', () => {
  it('sends the required brand toggles and the creator\'s comment, duet and stitch settings', async () => {
    const f = jest.fn().mockResolvedValue(json({ data: { publish_id: 'p', upload_url: 'https://u' }, error: { code: 'ok' } }));
    await initDirectPost(f, TOKEN, { caption: 'hi', privacyLevel: 'SELF_ONLY', videoSize: 100, disableComment: true, disableDuet: true, disableStitch: false });
    expect(JSON.parse(f.mock.calls[0][1].body).post_info).toEqual({ title: 'hi', privacy_level: 'SELF_ONLY', brand_content_toggle: false, brand_organic_toggle: false, disable_comment: true, disable_duet: true, disable_stitch: false });
  });
});

describe('describeFailReason (documented fail_reason values)', () => {
  it.each(['file_format_check_failed', 'duration_check_failed', 'frame_rate_check_failed', 'picture_size_check_failed', 'internal', 'publish_cancelled', 'auth_removed',
    'spam_risk_too_many_posts', 'spam_risk_user_banned_from_posting', 'spam_risk_text', 'spam_risk'])('%s has a plain-language message', (code) => {
    const d = describeFailReason(code);
    expect(d.message.length).toBeGreaterThan(15);
    expect(d.message).not.toContain(code);
  });
  it('only a temporary TikTok problem is worth retrying, and a removed authorisation asks for a reconnect', () => {
    expect(describeFailReason('internal').retryable).toBe(true);
    for (const c of ['file_format_check_failed', 'spam_risk', 'spam_risk_text', 'auth_removed']) expect(describeFailReason(c).retryable).toBe(false);
    expect(describeFailReason('auth_removed').reconnect).toBe(true);
    expect(describeFailReason('something_new').message).toMatch(/something_new/);
  });
});

describe('fetchPublishStatus', () => {
  const st = (data: object, status = 200) => jest.fn().mockResolvedValue(json({ data, error: { code: 'ok' } }, status));
  it('maps each TikTok state', async () => {
    expect(await fetchPublishStatus(st({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['77'] }), TOKEN, 'p')).toEqual({ kind: 'published', postId: '77' });
    expect(await fetchPublishStatus(st({ status: 'FAILED', fail_reason: 'picture_size_check_failed' }), TOKEN, 'p')).toMatchObject({ kind: 'failed', code: 'picture_size_check_failed', reason: expect.stringMatching(/360 and 4096/) });
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
