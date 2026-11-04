import { CONTRACT, TIKTOK_BUSINESS_API_BASE } from './tiktok-messaging.contract';
import { parseApiResponse, TikTokApiResult } from './tiktok-messaging.util';

/**
 * Thin HTTP client for the TikTok Business Messaging API. Every request/response field name below is taken from the contract file's provenance-tagged
 * paths and from reported payloads, i.e. ASSUMED until checked against the portal. Nothing here logs or returns an access token, and a network failure
 * never carries the URL or headers.
 */
type Fetch = typeof fetch;
const TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

/** A failure where we cannot know whether TikTok acted (timeout, reset): a send must not be blindly repeated. */
export type ClientFailure = Extract<TikTokApiResult<unknown>, { ok: false }> & { ambiguous?: boolean };
export type ClientResult<T> = { ok: true; data: T; requestId?: string } | ClientFailure;

async function call<T>(
  fetchFn: Fetch, method: 'GET' | 'POST', path: string,
  opts: { token?: string; query?: Record<string, string | number | undefined>; json?: unknown; form?: FormData; timeoutMs?: number } = {},
): Promise<ClientResult<T>> {
  const url = new URL(path, TIKTOK_BUSINESS_API_BASE);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (opts.token) headers['Access-Token'] = opts.token;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetchFn(url, {
      method, headers,
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return parseApiResponse<T>(res.status, body);
  } catch (e) {
    const name = e instanceof Error ? e.name : 'error';
    return { ok: false, code: 0, message: `TikTok could not be reached (${name})`, httpStatus: 0, retryable: true, ambiguous: true };
  }
}

export interface TikTokTokens { accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt?: string; businessId?: string; scope?: string }

function readTokens(data: Record<string, unknown>, now: Date): TikTokTokens | null {
  const access = typeof data['access_token'] === 'string' ? data['access_token'] : '';
  const refresh = typeof data['refresh_token'] === 'string' ? data['refresh_token'] : '';
  if (!access || !refresh) return null;
  const secs = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
  const exp = secs(data['expires_in']) ?? CONTRACT.accessTokenHours.value * 3600;
  const rexp = secs(data['refresh_expires_in']);
  const scope = Array.isArray(data['scope']) ? data['scope'].join(',') : typeof data['scope'] === 'string' ? data['scope'] : undefined;
  const businessId = typeof data['business_id'] === 'string' ? data['business_id'] : typeof data['open_id'] === 'string' ? data['open_id'] : undefined;
  return { accessToken: access, refreshToken: refresh, accessExpiresAt: new Date(now.getTime() + exp * 1000).toISOString(), ...(rexp && { refreshExpiresAt: new Date(now.getTime() + rexp * 1000).toISOString() }), businessId, scope };
}

export async function exchangeAuthCode(fetchFn: Fetch, p: { appId: string; secret: string; authCode: string }, now = new Date()): Promise<ClientResult<TikTokTokens>> {
  const r = await call<Record<string, unknown>>(fetchFn, 'POST', CONTRACT.tokenPath.value, { json: { app_id: p.appId, secret: p.secret, auth_code: p.authCode } });
  if (!r.ok) return r;
  const tokens = readTokens(r.data, now);
  return tokens ? { ok: true, data: tokens, requestId: r.requestId } : { ok: false, code: -1, message: 'TikTok returned no tokens', httpStatus: 200, retryable: false };
}

export async function refreshAccessToken(fetchFn: Fetch, p: { appId: string; secret: string; refreshToken: string }, now = new Date()): Promise<ClientResult<TikTokTokens>> {
  const r = await call<Record<string, unknown>>(fetchFn, 'POST', CONTRACT.refreshPath.value, { json: { app_id: p.appId, secret: p.secret, refresh_token: p.refreshToken } });
  if (!r.ok) return r;
  const tokens = readTokens(r.data, now);
  return tokens ? { ok: true, data: tokens, requestId: r.requestId } : { ok: false, code: -1, message: 'TikTok returned no tokens', httpStatus: 200, retryable: false };
}

export async function sendText(fetchFn: Fetch, token: string, p: { businessId: string; userId: string; conversationId?: string; text: string }): Promise<ClientResult<{ messageId: string }>> {
  const r = await call<Record<string, unknown>>(fetchFn, 'POST', CONTRACT.sendPath.value, {
    token, json: { business_id: p.businessId, recipient_id: p.userId, ...(p.conversationId && { conversation_id: p.conversationId }), message_type: 'TEXT', text: { body: p.text } },
  });
  return readSent(r);
}

export async function uploadImage(fetchFn: Fetch, token: string, p: { businessId: string; buffer: Buffer; mimeType: string }): Promise<ClientResult<{ mediaId: string }>> {
  const form = new FormData();
  form.set('business_id', p.businessId);
  form.set('image', new Blob([new Uint8Array(p.buffer)], { type: p.mimeType }), p.mimeType === 'image/png' ? 'image.png' : 'image.jpg');
  const r = await call<Record<string, unknown>>(fetchFn, 'POST', CONTRACT.imageUploadPath.value, { token, form, timeoutMs: UPLOAD_TIMEOUT_MS });
  if (!r.ok) return r;
  const id = r.data['media_id'] ?? r.data['image_id'];
  return typeof id === 'string' && id ? { ok: true, data: { mediaId: id }, requestId: r.requestId } : { ok: false, code: -1, message: 'TikTok returned no media id', httpStatus: 200, retryable: false };
}

export async function sendImage(fetchFn: Fetch, token: string, p: { businessId: string; userId: string; conversationId?: string; mediaId: string }): Promise<ClientResult<{ messageId: string }>> {
  const r = await call<Record<string, unknown>>(fetchFn, 'POST', CONTRACT.sendPath.value, {
    token, json: { business_id: p.businessId, recipient_id: p.userId, ...(p.conversationId && { conversation_id: p.conversationId }), message_type: 'IMAGE', image: { media_id: p.mediaId } },
  });
  return readSent(r);
}

function readSent(r: ClientResult<Record<string, unknown>>): ClientResult<{ messageId: string }> {
  if (!r.ok) return r;
  const id = r.data['message_id'] ?? r.data['msg_id'];
  // "Success" without an id means we cannot de-duplicate the echo later: treat it as ambiguous rather than inventing an id.
  return typeof id === 'string' && id ? { ok: true, data: { messageId: id }, requestId: r.requestId } : { ok: false, code: -1, message: 'TikTok did not return a message id', httpStatus: 200, retryable: false, ambiguous: true };
}

export async function downloadImage(fetchFn: Fetch, token: string, p: { businessId: string; mediaRef: string; messageId?: string }): Promise<{ ok: true; buffer: Buffer; mimeType: string } | { ok: false; reason: string }> {
  const url = new URL(CONTRACT.imageDownloadPath.value, TIKTOK_BUSINESS_API_BASE);
  url.searchParams.set('business_id', p.businessId);
  url.searchParams.set('media_id', p.mediaRef);
  if (p.messageId) url.searchParams.set('message_id', p.messageId);
  try {
    const res = await fetchFn(url, { method: 'GET', headers: { 'Access-Token': token }, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    // A JSON body here is TikTok's error envelope (HTTP 200 with a non-zero code), not an image.
    if (type.includes('json') || !type.startsWith('image/')) return { ok: false, reason: 'TikTok returned no image' };
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length > 0 && buffer.length <= 10 * 1024 * 1024 ? { ok: true, buffer, mimeType: type } : { ok: false, reason: 'image empty or too large' };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.name : 'error' };
  }
}

export interface RemoteConversation { id: string; userId?: string }
export interface Page<T> { items: T[]; cursor?: string }

export async function listConversations(fetchFn: Fetch, token: string, p: { businessId: string; cursor?: string; limit?: number }): Promise<ClientResult<Page<RemoteConversation>>> {
  const r = await call<Record<string, unknown>>(fetchFn, 'GET', CONTRACT.conversationListPath.value, { token, query: { business_id: p.businessId, cursor: p.cursor, limit: p.limit ?? 20 } });
  if (!r.ok) return r;
  const raw = Array.isArray(r.data['conversations']) ? r.data['conversations'] as Array<Record<string, unknown>> : [];
  const items = raw.flatMap((c) => (typeof c['conversation_id'] === 'string' ? [{ id: c['conversation_id'], userId: typeof c['user_id'] === 'string' ? c['user_id'] : undefined }] : []));
  return { ok: true, data: { items, cursor: r.data['has_more'] === true && typeof r.data['cursor'] === 'string' ? r.data['cursor'] : undefined }, requestId: r.requestId };
}

export async function listMessages(fetchFn: Fetch, token: string, p: { businessId: string; conversationId: string; cursor?: string; limit?: number }): Promise<ClientResult<Page<Record<string, unknown>>>> {
  const r = await call<Record<string, unknown>>(fetchFn, 'GET', CONTRACT.messageListPath.value, { token, query: { business_id: p.businessId, conversation_id: p.conversationId, cursor: p.cursor, limit: p.limit ?? 50 } });
  if (!r.ok) return r;
  const items = Array.isArray(r.data['messages']) ? (r.data['messages'] as unknown[]).filter((m): m is Record<string, unknown> => !!m && typeof m === 'object') : [];
  return { ok: true, data: { items, cursor: r.data['has_more'] === true && typeof r.data['cursor'] === 'string' ? r.data['cursor'] : undefined }, requestId: r.requestId };
}

/** App-level (one callback URL per app, not per account): who currently receives DIRECT_MESSAGE events. */
export async function getWebhook(fetchFn: Fetch, p: { appId: string; secret: string }): Promise<ClientResult<{ callbackUrl?: string }>> {
  const r = await call<Record<string, unknown>>(fetchFn, 'GET', CONTRACT.webhookListPath.value, { query: { app_id: p.appId, secret: p.secret, event_type: CONTRACT.webhookEventType.value } });
  if (!r.ok) return r;
  const list = Array.isArray(r.data['webhooks']) ? r.data['webhooks'] as Array<Record<string, unknown>> : [];
  const url = list.map((w) => w['callback_url']).find((u): u is string => typeof u === 'string');
  return { ok: true, data: { callbackUrl: url ?? (typeof r.data['callback_url'] === 'string' ? r.data['callback_url'] : undefined) }, requestId: r.requestId };
}

export async function setWebhook(fetchFn: Fetch, p: { appId: string; secret: string; callbackUrl: string }): Promise<ClientResult<Record<string, never>>> {
  const r = await call<Record<string, unknown>>(fetchFn, 'POST', CONTRACT.webhookUpdatePath.value, { json: { app_id: p.appId, secret: p.secret, event_type: CONTRACT.webhookEventType.value, callback_url: p.callbackUrl } });
  return r.ok ? { ok: true, data: {}, requestId: r.requestId } : r;
}
