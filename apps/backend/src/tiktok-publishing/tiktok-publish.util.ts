/**
 * TikTok Content Posting API (Direct Post, FILE_UPLOAD): the parts that need no database. All calls take an injected `fetchFn` so they are tested
 * without TikTok. Nothing here logs or returns the access token.
 *
 * Contract used (TikTok for Developers, Content Posting API): POST /v2/post/publish/video/init/ answers { data: { publish_id, upload_url }, error: { code } }
 * where error.code is "ok" on success; the video bytes are then PUT to upload_url in chunks with Content-Range; progress is read from
 * POST /v2/post/publish/status/fetch/. Needs the `video.publish` scope. Until TikTok audits the app, posts are limited to privacy SELF_ONLY.
 */
export const TIKTOK_API = 'https://open.tiktokapis.com';
export const TIKTOK_PUBLISH_SCOPE = 'video.publish';
export const TIKTOK_PRIVACY_LEVELS = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const;
export type TikTokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number];
export const TIKTOK_MAX_CAPTION = 2200;
export const TIKTOK_MAX_VIDEO_BYTES = 512 * 1024 * 1024; // the app's own storage limit; TikTok itself allows more
export const TIKTOK_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

type Fetch = typeof fetch;

export function hasPublishScope(scope: unknown): boolean {
  return typeof scope === 'string' && scope.split(',').map((s) => s.trim()).includes(TIKTOK_PUBLISH_SCOPE);
}

/** TikTok takes chunks of 5-64 MB (the last may be up to 128 MB). A file up to 64 MB goes as one chunk; larger files as 10 MB chunks with the remainder folded into the last. */
export function planChunks(size: number): { chunkSize: number; total: number } {
  if (size <= MAX_SINGLE_CHUNK) return { chunkSize: size, total: 1 };
  return { chunkSize: CHUNK, total: Math.floor(size / CHUNK) };
}

export type InitOutcome =
  | { kind: 'ok'; publishId: string; uploadUrl: string }
  /** TikTok answered and refused: nothing was created, so retrying later is safe when `retry` is true. */
  | { kind: 'refused'; code: string; message: string; retry: boolean; reconnect: boolean }
  /** The request definitely never reached TikTok (connection could not be opened): safe to retry. */
  | { kind: 'not-sent' }
  /** No usable answer (timeout, reset, unparseable): TikTok may have created the post. Never retry blindly. */
  | { kind: 'unknown' };

const RECONNECT_CODES = new Set(['access_token_invalid', 'scope_not_authorized', 'scope_permission_missed', 'token_not_authorized_for_this_endpoint']);
const RETRY_CODES = new Set(['rate_limit_exceeded', 'internal_error', 'server_error']);

function clean(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/[A-Za-z0-9_\-.]{40,}/g, '[redacted]').slice(0, max) : '';
}

function connectPhaseError(e: unknown): boolean {
  const code = ((e as { cause?: { code?: string } } | undefined)?.cause?.code) ?? '';
  return e instanceof TypeError && ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code);
}

async function post(fetchFn: Fetch, accessToken: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetchFn(`${TIKTOK_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let json: Record<string, unknown> | null = null;
  try { const t = await res.json(); json = t && typeof t === 'object' ? (t as Record<string, unknown>) : null; } catch { json = null; }
  return { status: res.status, json };
}

export async function initDirectPost(
  fetchFn: Fetch, accessToken: string,
  p: { caption: string; privacyLevel: TikTokPrivacyLevel; videoSize: number },
): Promise<InitOutcome> {
  const { chunkSize, total } = planChunks(p.videoSize);
  let r: Awaited<ReturnType<typeof post>>;
  try {
    r = await post(fetchFn, accessToken, '/v2/post/publish/video/init/', {
      post_info: { title: p.caption, privacy_level: p.privacyLevel },
      source_info: { source: 'FILE_UPLOAD', video_size: p.videoSize, chunk_size: chunkSize, total_chunk_count: total },
    });
  } catch (e) {
    return connectPhaseError(e) ? { kind: 'not-sent' } : { kind: 'unknown' };
  }
  if (!r.json) return r.status >= 500 || r.status === 0 ? { kind: 'unknown' } : { kind: 'refused', code: `http_${r.status}`, message: `TikTok answered HTTP ${r.status}`, retry: false, reconnect: r.status === 401 };
  const err = (r.json['error'] ?? {}) as Record<string, unknown>;
  const code = clean(err['code'], 60) || 'unknown';
  const data = (r.json['data'] ?? {}) as Record<string, unknown>;
  if (code === 'ok' && typeof data['publish_id'] === 'string' && typeof data['upload_url'] === 'string') {
    return { kind: 'ok', publishId: data['publish_id'], uploadUrl: data['upload_url'] };
  }
  if (code === 'ok') return { kind: 'unknown' }; // "ok" without the ids we need: do not assume anything was or was not created
  return { kind: 'refused', code, message: clean(err['message']) || code, retry: RETRY_CODES.has(code) || r.status === 429, reconnect: RECONNECT_CODES.has(code) || r.status === 401 };
}

/** Uploads the video in the planned chunks. Each chunk is retried (a PUT of the same range is idempotent). Returns an error string, or null on success. */
export async function uploadVideo(fetchFn: Fetch, uploadUrl: string, video: Buffer, mimeType: string, sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<string | null> {
  const { chunkSize, total } = planChunks(video.length);
  for (let i = 0; i < total; i++) {
    const start = i * chunkSize;
    const end = i === total - 1 ? video.length - 1 : start + chunkSize - 1;
    let lastErr = 'upload failed';
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const res = await fetchFn(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': mimeType, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${video.length}` },
          body: new Uint8Array(video.subarray(start, end + 1)),
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        if (res.status === 201 || res.status === 206 || res.status === 200) ok = true;
        else lastErr = `TikTok rejected upload chunk ${i + 1}/${total} (HTTP ${res.status})`;
      } catch (e) {
        lastErr = `upload chunk ${i + 1}/${total} did not complete (${e instanceof Error ? e.name : 'error'})`;
      }
      if (!ok && attempt < 2) await sleepFn(1000 * (attempt + 1));
    }
    if (!ok) return lastErr;
  }
  return null;
}

export type StatusOutcome =
  | { kind: 'processing'; detail: string }
  | { kind: 'published'; postId: string | null }
  | { kind: 'failed'; reason: string }
  | { kind: 'reconnect' }
  | { kind: 'unavailable' };

export async function fetchPublishStatus(fetchFn: Fetch, accessToken: string, publishId: string): Promise<StatusOutcome> {
  let r: Awaited<ReturnType<typeof post>>;
  try { r = await post(fetchFn, accessToken, '/v2/post/publish/status/fetch/', { publish_id: publishId }); } catch { return { kind: 'unavailable' }; }
  if (!r.json) return r.status === 401 ? { kind: 'reconnect' } : { kind: 'unavailable' };
  const err = (r.json['error'] ?? {}) as Record<string, unknown>;
  const code = clean(err['code'], 60);
  if (code && code !== 'ok') return RECONNECT_CODES.has(code) || r.status === 401 ? { kind: 'reconnect' } : { kind: 'unavailable' };
  const data = (r.json['data'] ?? {}) as Record<string, unknown>;
  const status = typeof data['status'] === 'string' ? data['status'] : '';
  if (status === 'PUBLISH_COMPLETE') {
    const ids = data['publicaly_available_post_id'] ?? data['publicly_available_post_id'];
    const first = Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : null;
    return { kind: 'published', postId: first ? clean(first, 40) : null };
  }
  if (status === 'FAILED') return { kind: 'failed', reason: clean(data['fail_reason'], 120) || 'TikTok could not publish this video' };
  if (status === 'PROCESSING_UPLOAD' || status === 'PROCESSING_DOWNLOAD' || status === 'SEND_TO_USER_INBOX') return { kind: 'processing', detail: status };
  return { kind: 'unavailable' };
}

/** Plain-language reason for a refusal code the user can act on. */
export function describeRefusal(code: string, message: string): string {
  switch (code) {
    case 'unaudited_client_can_only_post_to_private_accounts': return 'TikTok has not yet approved this app for public posting, so posts can only go to a private account. Use the "Only me" visibility.';
    case 'spam_risk_too_many_posts': return 'TikTok says this account reached its daily posting limit. Try again tomorrow.';
    case 'spam_risk_user_banned_from_posting': return 'TikTok has blocked this account from posting.';
    case 'privacy_level_option_mismatch': return 'TikTok does not allow this visibility for this account. Pick another one.';
    case 'reached_active_user_cap': return 'This TikTok app has reached its daily publishing limit. Try again tomorrow.';
    case 'invalid_file_upload': case 'invalid_param': return `TikTok rejected the video or details: ${message}`;
    default: return `TikTok refused the post (${code}): ${message}`;
  }
}
