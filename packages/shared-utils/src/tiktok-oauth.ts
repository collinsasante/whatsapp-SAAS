/**
 * TikTok Login Kit (v2) OAuth helpers shared by the API (authorization-code exchange, revoke) and the worker (token refresh), so the two
 * can never disagree about TikTok's wire format.
 *
 * Verified against TikTok's documentation (developers.tiktok.com, "Get a user access token", "Refresh a user access token",
 * "Revoke a user access token"; read 2026-11-04) and against a live call from the staging backend:
 *  - POST https://open.tiktokapis.com/v2/oauth/token/ takes application/x-www-form-urlencoded and answers with a FLAT JSON object:
 *      success { access_token, expires_in, refresh_token, refresh_expires_in, open_id, scope, token_type }
 *      failure { error: "<string>", error_description, log_id }   (HTTP status is 200 even for failures)
 *    It is NOT wrapped in { data, error: { code } }; that envelope belongs to the Content/Display APIs (for example /v2/user/info/).
 *  - Refresh tokens ROTATE: every refresh returns a new refresh_token and the old one stops working.
 *  - Expiry comes from expires_in / refresh_expires_in (seconds); nothing here hard-codes a lifetime.
 *
 * Nothing in this file logs. Every field that can reach a log line or a user-visible message goes through sanitiseToken/sanitiseText.
 */

export const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
export const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url';
export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
/** Refresh when the access token has less than this left. */
export const TIKTOK_REFRESH_LEAD_MS = 30 * 60_000;
export const TIKTOK_HTTP_TIMEOUT_MS = 10_000;

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  openId: string;
  /** Scopes TikTok says the user actually granted. */
  scopes: string[];
  accessExpiresAt: string;
  /** null when TikTok did not send refresh_expires_in. */
  refreshExpiresAt: string | null;
}

export interface TikTokTokenFailure {
  ok: false;
  /** api_error: TikTok answered with an error object; http_error: non-2xx without one; bad_response: not JSON or missing fields. */
  kind: 'api_error' | 'http_error' | 'bad_response';
  /** TikTok's own error code, for example invalid_grant, invalid_request, invalid_client. Sanitised. */
  error: string;
  description: string;
  logId?: string;
  httpStatus: number;
}

export type TikTokTokenResult = { ok: true; tokens: TikTokTokens } | TikTokTokenFailure;

/** Keeps only characters that can appear in an identifier-like field (error codes, log ids, scope names). */
export function sanitiseToken(value: unknown, max = 64): string {
  return typeof value === 'string' ? value.replace(/[^A-Za-z0-9_.:,-]/g, '').slice(0, max) : '';
}

/** Free text from TikTok: control characters and anything that looks like a bearer token or key=value secret are removed, then capped. */
export function sanitiseText(value: unknown, max = 200): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(act|rft|clt)\.[A-Za-z0-9._-]{8,}/g, '[redacted]')
    .replace(/\b(code|state|token|secret|access_token|refresh_token|client_secret)=\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positiveNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

export function parseTikTokTokenResponse(httpStatus: number, bodyText: string, now: Date = new Date()): TikTokTokenResult {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, kind: 'bad_response', error: 'invalid_response', description: `TikTok returned a response that is not JSON (HTTP ${httpStatus})`, httpStatus };
  }
  if (!isObject(body)) {
    return { ok: false, kind: 'bad_response', error: 'invalid_response', description: 'TikTok returned an unexpected JSON value', httpStatus };
  }

  // The documented error shape: a string `error`. The Content API envelope ({ error: { code, message, log_id } }) is also understood defensively.
  const errField = body['error'];
  if (typeof errField === 'string' && errField !== '' && errField !== 'ok') {
    return {
      ok: false, kind: 'api_error', httpStatus,
      error: sanitiseToken(errField) || 'unknown_error',
      description: sanitiseText(body['error_description']),
      logId: sanitiseToken(body['log_id']) || undefined,
    };
  }
  if (isObject(errField) && typeof errField['code'] === 'string' && errField['code'] !== 'ok') {
    return {
      ok: false, kind: 'api_error', httpStatus,
      error: sanitiseToken(errField['code']) || 'unknown_error',
      description: sanitiseText(errField['message']),
      logId: sanitiseToken(errField['log_id']) || undefined,
    };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ok: false, kind: 'http_error', error: `http_${httpStatus}`, description: `TikTok answered HTTP ${httpStatus} without an error body`, httpStatus };
  }

  const accessToken = body['access_token'];
  const refreshToken = body['refresh_token'];
  const openId = body['open_id'];
  const expiresIn = positiveNumber(body['expires_in']);
  const missing = [
    typeof accessToken === 'string' && accessToken ? '' : 'access_token',
    typeof refreshToken === 'string' && refreshToken ? '' : 'refresh_token',
    typeof openId === 'string' && openId ? '' : 'open_id',
    expiresIn ? '' : 'expires_in',
  ].filter(Boolean);
  if (missing.length > 0) {
    return { ok: false, kind: 'bad_response', error: 'incomplete_token_response', description: `TikTok's token response is missing: ${missing.join(', ')}`, httpStatus };
  }

  const refreshIn = positiveNumber(body['refresh_expires_in']);
  return {
    ok: true,
    tokens: {
      accessToken: accessToken as string,
      refreshToken: refreshToken as string,
      openId: openId as string,
      scopes: typeof body['scope'] === 'string' ? sanitiseToken(body['scope'], 512).split(',').filter(Boolean) : [],
      accessExpiresAt: new Date(now.getTime() + (expiresIn as number) * 1000).toISOString(),
      refreshExpiresAt: refreshIn ? new Date(now.getTime() + refreshIn * 1000).toISOString() : null,
    },
  };
}

/** One safe line for logs and for the message the dashboard shows. Contains TikTok's error code, its description and its log id; never a secret. */
export function describeTikTokFailure(f: TikTokTokenFailure): string {
  const ref = f.logId ? ` (TikTok ref ${f.logId})` : '';
  const text = f.description ? `: ${f.description}` : '';
  return `TikTok authorization failed [${f.error}]${text}${ref}`;
}

/** invalid_grant on a refresh means the refresh token is expired, revoked or already rotated: the user has to reconnect. */
export function isTikTokReauthRequired(f: TikTokTokenFailure): boolean {
  return f.kind === 'api_error' && (f.error === 'invalid_grant' || f.error === 'invalid_client' || f.error === 'access_denied');
}

export function tiktokExchangeBody(p: { clientKey: string; clientSecret: string; code: string; redirectUri: string }): string {
  return new URLSearchParams({ client_key: p.clientKey, client_secret: p.clientSecret, code: p.code, grant_type: 'authorization_code', redirect_uri: p.redirectUri }).toString();
}

export function tiktokRefreshBody(p: { clientKey: string; clientSecret: string; refreshToken: string }): string {
  return new URLSearchParams({ client_key: p.clientKey, client_secret: p.clientSecret, grant_type: 'refresh_token', refresh_token: p.refreshToken }).toString();
}

export function tiktokRevokeBody(p: { clientKey: string; clientSecret: string; token: string }): string {
  return new URLSearchParams({ client_key: p.clientKey, client_secret: p.clientSecret, token: p.token }).toString();
}

export function shouldRefreshTikTokToken(accessExpiresAt: string | null | undefined, now: Date = new Date(), leadMs: number = TIKTOK_REFRESH_LEAD_MS): boolean {
  if (!accessExpiresAt) return true;
  const t = Date.parse(accessExpiresAt);
  return Number.isNaN(t) || t - now.getTime() <= leadMs;
}

/** True when the refresh token itself has expired (nothing left to refresh with). */
export function isTikTokRefreshExpired(refreshExpiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!refreshExpiresAt) return false;
  const t = Date.parse(refreshExpiresAt);
  return !Number.isNaN(t) && t <= now.getTime();
}
