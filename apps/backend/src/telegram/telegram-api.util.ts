/**
 * Thin, token-safe client for the Telegram Bot API. The bot token is part of every Bot API URL, so NOTHING from a failed request (URL, raw error, fetch
 * message) is ever returned or logged: results carry Telegram's own numeric error code and a short sanitised description only.
 */
export const TELEGRAM_API = 'https://api.telegram.org';
export const TELEGRAM_TIMEOUT_MS = 15_000;
/** Bot API limit for getFile downloads. */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const TELEGRAM_MAX_TEXT = 4096;
export const TELEGRAM_MAX_CAPTION = 1024;

export interface TelegramResult<T = unknown> {
  ok: boolean;
  result?: T;
  /** Telegram's error_code (400, 401, 403, 429 ...); 0 for a network failure or timeout. */
  errorCode?: number;
  description?: string;
  retryAfter?: number;
}

const clean = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[token]').slice(0, max) : '';

type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function telegramCall<T = unknown>(
  botToken: string, method: string, payload: Record<string, unknown> | FormData,
  opts: { fetchFn?: Fetch; timeoutMs?: number; maxRetryAfterSec?: number; sleepFn?: (ms: number) => Promise<void> } = {},
): Promise<TelegramResult<T>> {
  const f = opts.fetchFn ?? fetch;
  const attempt = async (): Promise<TelegramResult<T>> => {
    try {
      const isForm = typeof FormData !== 'undefined' && payload instanceof FormData;
      const res = await f(`${TELEGRAM_API}/bot${botToken}/${method}`, {
        method: 'POST',
        ...(isForm ? { body: payload as FormData } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? TELEGRAM_TIMEOUT_MS),
      });
      let body: { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } } = {};
      try { body = await res.json(); } catch { /* non-JSON */ }
      if (body.ok) return { ok: true, result: body.result };
      return { ok: false, errorCode: body.error_code ?? res.status, description: clean(body.description) || `HTTP ${res.status}`, retryAfter: body.parameters?.retry_after };
    } catch (e) {
      return { ok: false, errorCode: 0, description: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network error' };
    }
  };
  let r = await attempt();
  // Rate limited: honour Telegram's retry_after once, if it is short.
  if (!r.ok && r.errorCode === 429 && r.retryAfter !== undefined && r.retryAfter <= (opts.maxRetryAfterSec ?? 5)) {
    await (opts.sleepFn ?? sleep)((r.retryAfter + 0.2) * 1000);
    r = await attempt();
  }
  return r;
}

export async function telegramDownload(botToken: string, filePath: string, opts: { fetchFn?: Fetch; timeoutMs?: number } = {}): Promise<{ buffer: Buffer; mimeType: string } | { error: string }> {
  try {
    const res = await (opts.fetchFn ?? fetch)(`${TELEGRAM_API}/file/bot${botToken}/${filePath}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > TELEGRAM_MAX_DOWNLOAD_BYTES) return { error: 'file too large' };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > TELEGRAM_MAX_DOWNLOAD_BYTES) return { error: 'file too large' };
    return { buffer, mimeType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim() };
  } catch (e) {
    return { error: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
}
