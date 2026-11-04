import {
  describeTikTokFailure, isTikTokReauthRequired, isTikTokRefreshExpired, parseTikTokTokenResponse, sanitiseText,
  shouldRefreshTikTokToken, TikTokTokenFailure,
} from '@whatsapp-platform/shared-utils';

const NOW = new Date('2026-11-04T12:00:00.000Z');

// The exact body the staging backend received from TikTok for an invalid authorization code (captured 2026-11-04, HTTP 200).
const LIVE_ERROR_BODY = JSON.stringify({ error: 'invalid_grant', error_description: 'Authorization code is expired.', log_id: '202611041208248D2E4ECAA3C0A20D01F7' });
// TikTok's documented success body: flat, no data/error wrapper.
const SUCCESS_BODY = JSON.stringify({
  access_token: 'act.ACCESS-TOKEN-VALUE-1', expires_in: 7200, refresh_token: 'rft.REFRESH-TOKEN-VALUE-1', refresh_expires_in: 15552000,
  open_id: 'open-id-123', scope: 'user.info.basic,video.list', token_type: 'Bearer',
});

describe('parseTikTokTokenResponse: the real TikTok contract', () => {
  it('reads the flat success body and computes absolute expiries from expires_in / refresh_expires_in', () => {
    const r = parseTikTokTokenResponse(200, SUCCESS_BODY, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tokens).toEqual({
      accessToken: 'act.ACCESS-TOKEN-VALUE-1', refreshToken: 'rft.REFRESH-TOKEN-VALUE-1', openId: 'open-id-123',
      scopes: ['user.info.basic', 'video.list'],
      accessExpiresAt: '2026-11-04T14:00:00.000Z',
      refreshExpiresAt: new Date(NOW.getTime() + 15552000 * 1000).toISOString(),
    });
  });

  it('reads the error body captured live from staging: this is the case that used to be reported as "unknown"', () => {
    const r = parseTikTokTokenResponse(200, LIVE_ERROR_BODY, NOW);
    expect(r).toMatchObject({ ok: false, kind: 'api_error', error: 'invalid_grant', description: 'Authorization code is expired.', logId: '202611041208248D2E4ECAA3C0A20D01F7', httpStatus: 200 });
    expect(describeTikTokFailure(r as TikTokTokenFailure)).toBe(
      'TikTok authorization failed [invalid_grant]: Authorization code is expired. (TikTok ref 202611041208248D2E4ECAA3C0A20D01F7)',
    );
  });

  it('the previous implementation could not have worked: the old check rejects both bodies', () => {
    // old logic: tokenData.error?.code !== 'ok' || !tokenData.data?.access_token  -> throw "... : unknown"
    const oldCheckThrows = (body: string) => { const d = JSON.parse(body) as { data?: { access_token?: string }; error?: { code?: string } }; return d.error?.code !== 'ok' || !d.data?.access_token; };
    expect(oldCheckThrows(SUCCESS_BODY)).toBe(true);
    expect(oldCheckThrows(LIVE_ERROR_BODY)).toBe(true);
  });

  it('also understands the Content API envelope defensively', () => {
    const r = parseTikTokTokenResponse(200, JSON.stringify({ error: { code: 'access_token_invalid', message: 'bad token', log_id: 'LOG1' } }), NOW);
    expect(r).toMatchObject({ ok: false, kind: 'api_error', error: 'access_token_invalid', description: 'bad token', logId: 'LOG1' });
  });

  it.each([
    ['html', '<html>Bad gateway</html>', 502, 'bad_response'],
    ['empty', '', 200, 'bad_response'],
    ['array', '[]', 200, 'bad_response'],
    ['json null', 'null', 200, 'bad_response'],
  ])('a %s response is a clean bad_response failure, never a thrown exception', (_n, body, status, kind) => {
    const r = parseTikTokTokenResponse(status, body, NOW);
    expect(r).toMatchObject({ ok: false, kind });
  });

  it('a non-2xx status without an error body is an http_error', () => {
    expect(parseTikTokTokenResponse(503, '{}', NOW)).toMatchObject({ ok: false, kind: 'http_error', error: 'http_503' });
  });

  it('a 200 whose body lacks required fields names only the missing FIELD NAMES', () => {
    const r = parseTikTokTokenResponse(200, JSON.stringify({ access_token: 'act.x1234567890', open_id: 'o' }), NOW);
    expect(r).toMatchObject({ ok: false, kind: 'bad_response', error: 'incomplete_token_response' });
    expect((r as TikTokTokenFailure).description).toContain('refresh_token');
    expect((r as TikTokTokenFailure).description).toContain('expires_in');
    expect((r as TikTokTokenFailure).description).not.toContain('act.x1234567890');
  });

  it('rejects non-positive or non-numeric expires_in', () => {
    for (const bad of [0, -5, '7200', null]) {
      expect(parseTikTokTokenResponse(200, JSON.stringify({ access_token: 'a', refresh_token: 'r', open_id: 'o', expires_in: bad }), NOW)).toMatchObject({ ok: false });
    }
  });
});

describe('sanitisation: nothing secret can reach a log line or the dashboard through TikTok-supplied text', () => {
  it('redacts bearer-style tokens and key=value secrets, strips control characters, and caps length', () => {
    const dirty = 'bad act.ABCDEFGHIJKLMNOP rft.QRSTUVWXYZ012345 code=SECRETCODE client_secret=SHHH\nnew\tline';
    const clean = sanitiseText(dirty);
    expect(clean).not.toMatch(/ABCDEFGHIJKLMNOP|QRSTUVWXYZ012345|SECRETCODE|SHHH/);
    expect(clean).not.toMatch(/[\n\t]/);
    expect(sanitiseText('x'.repeat(1000)).length).toBe(200);
  });

  it('error codes and log ids keep only identifier characters', () => {
    const r = parseTikTokTokenResponse(200, JSON.stringify({ error: 'invalid_grant<script>alert(1)</script>', error_description: 'ok', log_id: 'LOG 1;DROP' }));
    expect(r).toMatchObject({ ok: false, error: 'invalid_grantscriptalert1script', logId: 'LOG1DROP' });
  });
});

describe('refresh scheduling helpers', () => {
  it('refreshes when under 30 minutes remain, or when the expiry is missing or unreadable', () => {
    expect(shouldRefreshTikTokToken('2026-11-04T12:29:00.000Z', NOW)).toBe(true);
    expect(shouldRefreshTikTokToken('2026-11-04T12:31:00.000Z', NOW)).toBe(false);
    expect(shouldRefreshTikTokToken(undefined, NOW)).toBe(true);
    expect(shouldRefreshTikTokToken('not-a-date', NOW)).toBe(true);
  });
  it('a refresh token past its expiry cannot be used', () => {
    expect(isTikTokRefreshExpired('2026-11-04T11:59:59.000Z', NOW)).toBe(true);
    expect(isTikTokRefreshExpired('2026-11-05T00:00:00.000Z', NOW)).toBe(false);
    expect(isTikTokRefreshExpired(undefined, NOW)).toBe(false);
  });
  it('invalid_grant / invalid_client / access_denied require the user to reconnect; a network or 5xx failure does not', () => {
    const f = (error: string, kind: TikTokTokenFailure['kind'] = 'api_error'): TikTokTokenFailure => ({ ok: false, kind, error, description: '', httpStatus: 200 });
    expect(isTikTokReauthRequired(f('invalid_grant'))).toBe(true);
    expect(isTikTokReauthRequired(f('invalid_client'))).toBe(true);
    expect(isTikTokReauthRequired(f('access_denied'))).toBe(true);
    expect(isTikTokReauthRequired(f('invalid_request'))).toBe(false);
    expect(isTikTokReauthRequired(f('http_503', 'http_error'))).toBe(false);
  });
});
