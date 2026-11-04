import * as crypto from 'crypto';
import { CONTRACT } from './tiktok-messaging.contract';

/** Pure helpers for the TikTok Business Messaging adapter. No I/O. Wire details come from tiktok-messaging.contract.ts and are NOT verified against a real account. */

// ─── webhook signature ──────────────────────────────────────────────────────────────────────────────

export function parseSignatureHeader(header: string | undefined): { t: number; s: string } | null {
  if (!header) return null;
  const parts = Object.fromEntries(header.split(',').map((p) => { const i = p.indexOf('='); return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : ['', '']; }));
  const t = Number(parts['t']);
  const s = parts['s'];
  return Number.isFinite(t) && t > 0 && typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s) ? { t, s: s.toLowerCase() } : null;
}

export function computeSignature(appSecret: string, t: number, rawBody: string | Buffer): string {
  return crypto.createHmac('sha256', appSecret).update(`${t}.`).update(rawBody).digest('hex');
}

/** Constant-time check, and rejects a stale timestamp (replay) either side of now. */
export function verifyTikTokSignature(appSecret: string, header: string | undefined, rawBody: string | Buffer | undefined, nowMs: number = Date.now()): boolean {
  if (!appSecret || rawBody === undefined) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowMs / 1000 - parsed.t) > CONTRACT.signatureToleranceSeconds.value) return false;
  const expected = Buffer.from(computeSignature(appSecret, parsed.t, rawBody), 'hex');
  const given = Buffer.from(parsed.s, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// ─── API responses ──────────────────────────────────────────────────────────────────────────────────

export type TikTokApiResult<T> = { ok: true; data: T; requestId?: string } | { ok: false; code: number; message: string; httpStatus: number; requestId?: string; retryable: boolean };

/** TikTok answers HTTP 200 with a non-zero `code` on failure, so the status line alone proves nothing. */
export function parseApiResponse<T>(httpStatus: number, body: unknown): TikTokApiResult<T> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b['code'] === 'number' ? b['code'] : httpStatus >= 400 ? httpStatus : -1;
  const requestId = typeof b['request_id'] === 'string' ? b['request_id'].slice(0, 64) : undefined;
  if (httpStatus >= 200 && httpStatus < 300 && code === 0) return { ok: true, data: (b['data'] ?? {}) as T, requestId };
  const message = typeof b['message'] === 'string' ? b['message'].replace(/[\r\n\t]+/g, ' ').replace(/[A-Za-z0-9_\-.]{40,}/g, '[redacted]').slice(0, 200) : `HTTP ${httpStatus}`;
  // Rate limits and server faults are worth retrying; auth and validation errors are not.
  return { ok: false, code, message, httpStatus, requestId, retryable: httpStatus === 429 || httpStatus >= 500 };
}

/** Codes that mean the stored authorisation is no longer usable. TikTok's numeric codes are not confirmed, so this keys off the HTTP status and message words too. */
export function isAuthFailure(r: Extract<TikTokApiResult<unknown>, { ok: false }>): boolean {
  return r.httpStatus === 401 || /token|expired|unauthori[sz]ed|permission|scope/i.test(r.message);
}

// ─── inbound events ─────────────────────────────────────────────────────────────────────────────────

export type TikTokInboundKind = 'text' | 'image' | 'share_post' | 'sticker' | 'unsupported';
export interface TikTokInboundEvent {
  /** Our business account (the recipient of an inbound message, the sender of an echo). */
  businessId: string;
  /** The TikTok user on the other side. */
  userId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  messageId: string;
  conversationId?: string;
  kind: TikTokInboundKind;
  text?: string;
  /** Image reference to download through the API (no public URL is assumed). */
  imageRef?: string;
  link?: string;
  timestampMs?: number;
}
export type NormalisedEvent = { ok: true; event: TikTokInboundEvent } | { ok: false; reason: 'not-a-message' | 'malformed' | 'read-receipt' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '') ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);
const first = (o: Obj, ...keys: string[]) => { for (const k of keys) { const v = str(o[k]); if (v) return v; } return undefined; };

/**
 * Reads one webhook body. The event envelope ({ event, user_openid, content }) follows TikTok's usual webhook layout and the message fields are taken from an
 * integrator's reported payloads; both are ASSUMED. Anything that does not fit is rejected rather than guessed at, so an unexpected shape is visible in the
 * webhook's "ignored" counter instead of storing a wrong message.
 */
export function normaliseTikTokEvent(body: unknown): NormalisedEvent {
  if (!isObj(body)) return { ok: false, reason: 'malformed' };
  const name = str(body['event']);
  if (name === CONTRACT.eventNames.value.read) return { ok: false, reason: 'read-receipt' };
  if (name !== CONTRACT.eventNames.value.message) return { ok: false, reason: 'not-a-message' };

  let content: unknown = body['content'];
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch { return { ok: false, reason: 'malformed' }; } }
  if (!isObj(content)) return { ok: false, reason: 'malformed' };

  const businessId = first(body, 'user_openid', 'business_id') ?? first(content, 'business_id');
  const fromObj = isObj(content['from_user']) ? content['from_user'] : undefined;
  const toObj = isObj(content['to_user']) ? content['to_user'] : undefined;
  const from = (fromObj && first(fromObj, 'id', 'user_id', 'open_id')) ?? first(content, 'from_user_id', 'from');
  const to = (toObj && first(toObj, 'id', 'user_id', 'open_id')) ?? first(content, 'to_user_id', 'to');
  const messageId = first(content, 'message_id', 'msg_id', 'id');
  if (!businessId || !from || !messageId) return { ok: false, reason: 'malformed' };

  // Direction is decided by who sent it, not by the event name: an echo of our own reply names our account as the sender.
  const outbound = from === businessId;
  const userId = outbound ? to : from;
  if (!userId) return { ok: false, reason: 'malformed' };

  const type = (first(content, 'message_type', 'type') ?? 'text').toLowerCase();
  const textObj = isObj(content['text']) ? content['text'] : undefined;
  const text = (textObj && first(textObj, 'body', 'text')) ?? (typeof content['text'] === 'string' ? content['text'] : undefined);
  const imageObj = isObj(content['image']) ? content['image'] : undefined;
  const ts = Number(first(content, 'timestamp', 'create_time') ?? body['create_time']);
  const timestampMs = Number.isFinite(ts) && ts > 0 ? (ts < 1e12 ? ts * 1000 : ts) : undefined;

  const base = { businessId, userId, direction: outbound ? 'OUTBOUND' as const : 'INBOUND' as const, messageId, conversationId: first(content, 'conversation_id'), timestampMs };
  if (type === 'text' && text) return { ok: true, event: { ...base, kind: 'text', text } };
  if (type === 'image') {
    const imageRef = imageObj && first(imageObj, 'media_id', 'image_id', 'id');
    return imageRef ? { ok: true, event: { ...base, kind: 'image', imageRef } } : { ok: true, event: { ...base, kind: 'unsupported' } };
  }
  if (type === 'share_post') {
    const share = isObj(content['share_post']) ? content['share_post'] : isObj(content['embed']) ? content['embed'] : undefined;
    return { ok: true, event: { ...base, kind: 'share_post', link: share && first(share, 'url', 'link', 'embed_url') } };
  }
  if (type === 'sticker') return { ok: true, event: { ...base, kind: 'sticker' } };
  return { ok: true, event: { ...base, kind: 'unsupported' } };
}

/** The key stored in Message.whatsappMessageId (the column every channel uses for the provider's id). */
export const tiktokMessageKey = (businessId: string, messageId: string) => `tt:${businessId}:${messageId}`;
export const tiktokProviderIdFromKey = (key: string | undefined | null): string | undefined => {
  const m = /^tt:[^:]+:(.+)$/.exec(key ?? '');
  return m?.[1];
};

// ─── outbound rules ─────────────────────────────────────────────────────────────────────────────────

export const replyWindowMs = () => CONTRACT.replyWindowHours.value * 60 * 60 * 1000;
export function isReplyWindowOpen(lastInboundAt: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  return !Number.isNaN(t) && now - t <= replyWindowMs();
}

export function validateOutboundText(text: string): string | null {
  if (!text.trim()) return 'Write a message first.';
  if (text.length > CONTRACT.maxTextChars.value) return `TikTok messages can be at most ${CONTRACT.maxTextChars.value} characters.`;
  return null;
}

export function validateOutboundImage(mimeType: string, size: number): string | null {
  const mime = mimeType.split(';')[0]!.trim().toLowerCase();
  if (!(CONTRACT.imageMimeTypes.value as readonly string[]).includes(mime)) return 'TikTok only accepts JPG or PNG images.';
  if (size <= 0 || size > CONTRACT.imageMaxBytes.value) return `TikTok images must be under ${CONTRACT.imageMaxBytes.value / 1024 / 1024} MB.`;
  return null;
}

/** Plain-language reason shown on a failed message. */
export function describeSendFailure(r: Extract<TikTokApiResult<unknown>, { ok: false }>): string {
  if (isAuthFailure(r)) return 'TikTok no longer accepts this connection. Reconnect the TikTok account in Channels.';
  if (r.httpStatus === 429) return 'TikTok is rate limiting this account. Try again in a moment.';
  if (r.httpStatus >= 500) return 'TikTok had a problem. Try again in a moment.';
  if (/window|expire|first|initiat/i.test(r.message)) return 'TikTok only lets you reply after the person messages you, and for a limited time. Wait for their next message.';
  return `TikTok rejected the message (code ${r.code}).`;
}
