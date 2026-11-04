/**
 * TikTok Content Posting API (Direct Post, FILE_UPLOAD): the parts that need no database. All calls take an injected `fetchFn` so they are tested
 * without TikTok. Nothing here logs or returns the access token.
 *
 * Contract VERIFIED against TikTok's published Content Posting API pages on 2026-11-04 (developers.tiktok.com: Direct Post reference, Query Creator Info,
 * Get Video Status, Media Transfer Guide). Verified from documentation only: no call has been made to TikTok.
 *   - POST /v2/post/publish/creator_info/query/ (20/min per token) gives privacy_level_options and the creator's comment/duet/stitch settings;
 *     posting limits can come back as HTTP 200 with a non-ok error.code.
 *   - POST /v2/post/publish/video/init/ (6/min per token) answers { data: { publish_id, upload_url }, error: { code } }, code "ok" on success.
 *   - FILE_UPLOAD: chunks of 5-64 MB (final chunk up to 128 MB), total_chunk_count = floor(size / chunk_size), at most 1000, a file under 5 MB in one chunk,
 *     uploaded sequentially by PUT with Content-Range; 206 = more to come, 201 = complete; 5xx retry; 400/403/404/416 are not retryable.
 *   - POST /v2/post/publish/status/fetch/ (30/min) -> PROCESSING_UPLOAD | PROCESSING_DOWNLOAD | SEND_TO_USER_INBOX | PUBLISH_COMPLETE | FAILED + fail_reason.
 * Needs `video.publish`. Until TikTok audits the app, posts are limited to privacy SELF_ONLY.
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

// Documented codes only. 401 access_token_invalid / scope_not_authorized mean the connection must be redone; 429 rate_limit_exceeded and 5xx internal_error are worth retrying.
const RECONNECT_CODES = new Set(['access_token_invalid', 'scope_not_authorized', 'token_not_authorized_for_specified_publish_id']);
const RETRY_CODES = new Set(['rate_limit_exceeded', 'internal_error']);

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
  p: { caption: string; privacyLevel: TikTokPrivacyLevel; videoSize: number; disableComment?: boolean; disableDuet?: boolean; disableStitch?: boolean },
): Promise<InitOutcome> {
  const { chunkSize, total } = planChunks(p.videoSize);
  let r: Awaited<ReturnType<typeof post>>;
  try {
    r = await post(fetchFn, accessToken, '/v2/post/publish/video/init/', {
      // The two brand toggles are marked required by TikTok; this app never posts branded content. The creator's own comment/duet/stitch settings are respected.
      post_info: {
        title: p.caption, privacy_level: p.privacyLevel, brand_content_toggle: false, brand_organic_toggle: false,
        ...(p.disableComment !== undefined && { disable_comment: p.disableComment }), ...(p.disableDuet !== undefined && { disable_duet: p.disableDuet }), ...(p.disableStitch !== undefined && { disable_stitch: p.disableStitch }),
      },
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
  return { kind: 'refused', code, message: clean(err['message']) || code, retry: RETRY_CODES.has(code) || r.status === 429 || r.status >= 500, reconnect: RECONNECT_CODES.has(code) || r.status === 401 };
}

/**
 * Uploads the video sequentially in the planned chunks, as TikTok documents: a partial chunk answers 206 and the final chunk 201 (which is what starts
 * the post). 5xx and network failures retry the same range (a PUT of one range is idempotent); 400, 403 (expired upload address), 404 and 416 do not,
 * because repeating the same request cannot fix them. Returns an error sentence, or null on success.
 */
export async function uploadVideo(fetchFn: Fetch, uploadUrl: string, video: Buffer, mimeType: string, sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<string | null> {
  const { chunkSize, total } = planChunks(video.length);
  for (let i = 0; i < total; i++) {
    const start = i * chunkSize;
    const end = i === total - 1 ? video.length - 1 : start + chunkSize - 1;
    const expected = i === total - 1 ? 201 : 206;
    let lastErr = 'upload failed';
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const res = await fetchFn(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': mimeType, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${video.length}` },
          body: new Uint8Array(video.subarray(start, end + 1)),
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        if (res.status === expected) { done = true; break; }
        if (res.status >= 500) lastErr = `TikTok had a problem receiving chunk ${i + 1}/${total} (HTTP ${res.status})`;
        else if (res.status === 403) return 'TikTok\'s upload address expired before the video was sent';
        else if (res.status === 404) return 'TikTok no longer recognises this upload';
        else if (res.status === 416 || res.status === 400) return `TikTok rejected chunk ${i + 1}/${total} (HTTP ${res.status})`;
        else return `TikTok answered chunk ${i + 1}/${total} with an unexpected status (HTTP ${res.status}, expected ${expected})`;
      } catch (e) {
        lastErr = `upload chunk ${i + 1}/${total} did not complete (${e instanceof Error ? e.name : 'error'})`;
      }
      if (attempt < 2) await sleepFn(1000 * (attempt + 1));
    }
    if (!done) return lastErr;
  }
  return null;
}

export type CreatorInfoOutcome =
  | { kind: 'ok'; privacyOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxDurationSec?: number }
  /** TikTok answered and the creator cannot post now (daily cap, ban, client quota) or the token is bad. */
  | { kind: 'refused'; code: string; message: string; retry: boolean; reconnect: boolean }
  /** No usable answer. This call changes nothing at TikTok, so trying again later is always safe. */
  | { kind: 'unavailable' };

/** TikTok requires this query before every post: the creator's allowed visibilities and settings, and posting limits (which arrive as HTTP 200 with a non-ok code). */
export async function queryCreatorInfo(fetchFn: Fetch, accessToken: string): Promise<CreatorInfoOutcome> {
  let r: Awaited<ReturnType<typeof post>>;
  try { r = await post(fetchFn, accessToken, '/v2/post/publish/creator_info/query/', {}); } catch { return { kind: 'unavailable' }; }
  if (!r.json) return r.status === 401 ? { kind: 'refused', code: 'access_token_invalid', message: 'token rejected', retry: false, reconnect: true } : { kind: 'unavailable' };
  const err = (r.json['error'] ?? {}) as Record<string, unknown>;
  const code = clean(err['code'], 60) || 'unknown';
  if (code !== 'ok') return { kind: 'refused', code, message: clean(err['message']) || code, retry: RETRY_CODES.has(code) || r.status === 429 || r.status >= 500, reconnect: RECONNECT_CODES.has(code) || r.status === 401 };
  const d = (r.json['data'] ?? {}) as Record<string, unknown>;
  const options = Array.isArray(d['privacy_level_options']) ? d['privacy_level_options'].filter((x): x is string => typeof x === 'string') : [];
  return {
    kind: 'ok', privacyOptions: options, commentDisabled: d['comment_disabled'] === true, duetDisabled: d['duet_disabled'] === true, stitchDisabled: d['stitch_disabled'] === true,
    ...(typeof d['max_video_post_duration_sec'] === 'number' && { maxDurationSec: d['max_video_post_duration_sec'] }),
  };
}

export type StatusOutcome =
  | { kind: 'processing'; detail: string }
  | { kind: 'published'; postId: string | null }
  | { kind: 'failed'; reason: string; code: string }
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
  if (status === 'FAILED') { const code = clean(data['fail_reason'], 60) || 'unknown'; return { kind: 'failed', code, reason: describeFailReason(code).message }; }
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
    case 'invalid_param': return `TikTok rejected the video or details: ${message}`;
    case 'rate_limit_exceeded': return 'TikTok is limiting how often this account can post. Try again in a minute.';
    default: return `TikTok refused the post (${code}): ${message}`;
  }
}

/** TikTok's documented `fail_reason` values, in plain language, with whether a person should try again or the account must be reconnected. */
export function describeFailReason(code: string): { message: string; retryable: boolean; reconnect: boolean } {
  switch (code) {
    case 'file_format_check_failed': return { message: 'TikTok does not support this video format. Use MP4 (H.264 recommended), MOV or WebM.', retryable: false, reconnect: false };
    case 'duration_check_failed': return { message: 'The video length is outside what this TikTok account may post.', retryable: false, reconnect: false };
    case 'frame_rate_check_failed': return { message: 'TikTok needs a frame rate between 23 and 60 fps.', retryable: false, reconnect: false };
    case 'picture_size_check_failed': return { message: 'TikTok needs the video to be between 360 and 4096 pixels on each side.', retryable: false, reconnect: false };
    case 'internal': return { message: 'TikTok had a temporary problem publishing the video. Try again.', retryable: true, reconnect: false };
    case 'publish_cancelled': return { message: 'The post was cancelled.', retryable: false, reconnect: false };
    case 'auth_removed': return { message: 'The creator removed this app\'s access on TikTok. Reconnect the account to post again.', retryable: false, reconnect: true };
    case 'spam_risk_too_many_posts': return { message: 'This account reached TikTok\'s limit for posts through apps in 24 hours. Post from the TikTok app, or try tomorrow.', retryable: false, reconnect: false };
    case 'spam_risk_user_banned_from_posting': return { message: 'TikTok has blocked this account from posting.', retryable: false, reconnect: false };
    case 'spam_risk_text': return { message: 'TikTok flagged the caption. Change the text and try again.', retryable: false, reconnect: false };
    case 'spam_risk': return { message: 'TikTok flagged this post as risky and will not publish it.', retryable: false, reconnect: false };
    default: return { message: `TikTok could not publish this video (${code}).`, retryable: false, reconnect: false };
  }
}
