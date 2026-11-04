import { createHmac } from 'crypto';
import {
  computeSignature, describeSendFailure, isReplyWindowOpen, normaliseTikTokEvent, parseApiResponse, parseSignatureHeader, tiktokMessageKey,
  validateOutboundImage, validateOutboundText, verifyTikTokSignature,
} from './tiktok-messaging.util';
import { CONTRACT, unconfirmedContractItems } from './tiktok-messaging.contract';

const SECRET = 's3cret';
const body = '{"a":1}';
const header = (t: number, secret = SECRET, raw = body) => `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;

describe('webhook signature', () => {
  const now = 1_800_000_000_000;
  const t = now / 1000;
  it('accepts a correct signature within the tolerance', () => expect(verifyTikTokSignature(SECRET, header(t), body, now)).toBe(true));
  it.each([
    ['wrong secret', header(t, 'other')], ['tampered body', header(t, SECRET, '{"a":2}')], ['no header', undefined], ['garbage', 'x=y'],
    ['stale', header(t - 6)], ['from the future', header(t + 6)], ['short digest', `t=${t},s=abcd`],
  ])('rejects %s', (_n, h) => expect(verifyTikTokSignature(SECRET, h as string | undefined, body, now)).toBe(false));
  it('rejects when no secret is configured or the raw body is missing', () => {
    expect(verifyTikTokSignature('', header(t), body, now)).toBe(false);
    expect(verifyTikTokSignature(SECRET, header(t), undefined, now)).toBe(false);
  });
  it('accepts a boundary timestamp', () => expect(verifyTikTokSignature(SECRET, header(t - CONTRACT.signatureToleranceSeconds.value), body, now)).toBe(true));
  it('parses and computes consistently', () => {
    expect(parseSignatureHeader(header(5))).toMatchObject({ t: 5 });
    expect(computeSignature(SECRET, 5, body)).toHaveLength(64);
  });
});

describe('parseApiResponse', () => {
  it('treats HTTP 200 with a non-zero code as a failure', () => {
    expect(parseApiResponse(200, { code: 40001, message: 'bad' })).toMatchObject({ ok: false, code: 40001, retryable: false });
  });
  it('returns data on code 0', () => expect(parseApiResponse(200, { code: 0, data: { x: 1 }, request_id: 'r' })).toEqual({ ok: true, data: { x: 1 }, requestId: 'r' }));
  it('marks 429 and 5xx retryable, not 4xx', () => {
    expect(parseApiResponse(429, { code: 1 })).toMatchObject({ retryable: true });
    expect(parseApiResponse(503, null)).toMatchObject({ retryable: true });
    expect(parseApiResponse(400, { code: 1 })).toMatchObject({ retryable: false });
  });
  it('treats a body without a code as a failure and redacts token-like strings', () => {
    expect(parseApiResponse(200, {})).toMatchObject({ ok: false });
    const r = parseApiResponse(400, { code: 1, message: `bad ${'A'.repeat(50)}` });
    expect(JSON.stringify(r)).not.toContain('A'.repeat(50));
  });
});

describe('normaliseTikTokEvent', () => {
  const wrap = (content: object, extra: object = {}) => ({ event: 'im_send_msg', user_openid: 'biz', content: JSON.stringify(content), ...extra });
  it('reads an inbound text', () => {
    expect(normaliseTikTokEvent(wrap({ message_id: 'm1', conversation_id: 'c', from_user: { id: 'u' }, to_user: { id: 'biz' }, message_type: 'text', text: { body: 'hi' }, timestamp: 1_800_000_000 })))
      .toEqual({ ok: true, event: { businessId: 'biz', userId: 'u', direction: 'INBOUND', messageId: 'm1', conversationId: 'c', kind: 'text', text: 'hi', timestampMs: 1_800_000_000_000 } });
  });
  it('decides direction by sender, so our own echo is OUTBOUND', () => {
    const r = normaliseTikTokEvent(wrap({ message_id: 'm2', from_user: { id: 'biz' }, to_user: { id: 'u' }, text: { body: 'x' } }));
    expect(r).toMatchObject({ ok: true, event: { direction: 'OUTBOUND', userId: 'u' } });
  });
  it('accepts content as an object, maps images, posts and stickers', () => {
    const base = { message_id: 'm', from_user: { id: 'u' }, to_user: { id: 'biz' } };
    expect(normaliseTikTokEvent({ event: 'im_send_msg', user_openid: 'biz', content: { ...base, message_type: 'image', image: { media_id: 'img' } } })).toMatchObject({ event: { kind: 'image', imageRef: 'img' } });
    expect(normaliseTikTokEvent(wrap({ ...base, message_type: 'share_post', share_post: { url: 'https://t/x' } }))).toMatchObject({ event: { kind: 'share_post', link: 'https://t/x' } });
    expect(normaliseTikTokEvent(wrap({ ...base, message_type: 'sticker' }))).toMatchObject({ event: { kind: 'sticker' } });
    expect(normaliseTikTokEvent(wrap({ ...base, message_type: 'video' }))).toMatchObject({ event: { kind: 'unsupported' } });
    expect(normaliseTikTokEvent(wrap({ ...base, message_type: 'image' }))).toMatchObject({ event: { kind: 'unsupported' } });
  });
  it.each([
    ['null', null], ['an array', []], ['other event', { event: 'something_else' }], ['read receipt', { event: 'im_mark_read_msg' }],
    ['content not JSON', { event: 'im_send_msg', user_openid: 'b', content: '{' }], ['no sender', wrap({ message_id: 'm' })], ['no id', wrap({ from_user: { id: 'u' } })],
  ])('ignores %s', (_n, v) => expect(normaliseTikTokEvent(v)).toMatchObject({ ok: false }));
});

describe('outbound rules', () => {
  const now = Date.now();
  it('keeps the reply window at 48 hours from the last inbound', () => {
    expect(isReplyWindowOpen(new Date(now - 47 * 3_600_000), now)).toBe(true);
    expect(isReplyWindowOpen(new Date(now - 49 * 3_600_000), now)).toBe(false);
    expect(isReplyWindowOpen(null, now)).toBe(false);
    expect(isReplyWindowOpen('nonsense', now)).toBe(false);
  });
  it('validates text and images', () => {
    expect(validateOutboundText('  ')).toMatch(/Write a message/);
    expect(validateOutboundText('x'.repeat(6001))).toMatch(/6000/);
    expect(validateOutboundText('ok')).toBeNull();
    expect(validateOutboundImage('image/png', 100)).toBeNull();
    expect(validateOutboundImage('image/gif', 100)).toMatch(/JPG or PNG/);
    expect(validateOutboundImage('image/jpeg', 3 * 1024 * 1024 + 1)).toMatch(/3 MB/);
    expect(validateOutboundImage('image/jpeg', 0)).toMatch(/3 MB/);
  });
  it('keys messages by account and id', () => expect(tiktokMessageKey('b', 'm')).toBe('tt:b:m'));
  it('explains failures in plain words', () => {
    expect(describeSendFailure({ ok: false, code: 1, message: 'Access token invalid', httpStatus: 401, retryable: false })).toMatch(/Reconnect/);
    expect(describeSendFailure({ ok: false, code: 1, message: 'x', httpStatus: 429, retryable: true })).toMatch(/rate limiting/);
  });
});

describe('contract provenance', () => {
  it('lists every unconfirmed item, none of them official, and includes the paths we could not read', () => {
    const items = unconfirmedContractItems();
    expect(items.every((i) => i.provenance !== 'official')).toBe(true);
    expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(['sendPath', 'tokenPath', 'signatureAlgorithm', 'conversationListPath']));
  });
});
