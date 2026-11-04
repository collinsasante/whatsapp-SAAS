'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { mediaApi, tiktokPublishingApi, type TikTokPublication, type TikTokPublicationStatus } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';

const STATUS: Record<TikTokPublicationStatus, { label: string; tone: string }> = {
  QUEUED: { label: 'Waiting to send', tone: 'bg-gray-50 text-gray-600 border-gray-200' },
  UPLOADING: { label: 'Sending to TikTok', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  PROCESSING: { label: 'TikTok is processing', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  PUBLISHED: { label: 'Posted', tone: 'bg-green-50 text-green-700 border-green-200' },
  FAILED: { label: 'Failed', tone: 'bg-red-50 text-red-700 border-red-200' },
  UNCERTAIN: { label: 'Check TikTok', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  NEEDS_RECONNECT: { label: 'Reconnect needed', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-gray-50 text-gray-500 border-gray-200' },
};
const PRIVACY: Record<string, string> = {
  SELF_ONLY: 'Only me', FOLLOWER_OF_CREATOR: 'Followers', MUTUAL_FOLLOW_FRIENDS: 'Friends', PUBLIC_TO_EVERYONE: 'Everyone',
};
const IN_PROGRESS: TikTokPublicationStatus[] = ['QUEUED', 'UPLOADING', 'PROCESSING'];
const ACCEPTED = 'video/mp4,video/quicktime,video/webm';

const errorMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
    ? [(e as { response: { data: { message: string | string[] } } }).response.data.message].flat().join(' ')
    : fallback;

/** Post a video to the connected TikTok account. Renders nothing unless TikTok publishing is switched on for this workspace. */
export function TikTokPublishPanel({ channelId }: { channelId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const canPost = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [config, setConfig] = useState<{ enabled: boolean; allowedPrivacyLevels: string[]; maxCaption: number } | null>(null);
  const [posts, setPosts] = useState<TikTokPublication[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try { setPosts((await tiktokPublishingApi.list(channelId)).data); } catch { /* the list is refreshed again shortly */ }
  }, [channelId]);

  useEffect(() => {
    let live = true;
    tiktokPublishingApi.config().then((r) => { if (live) { setConfig(r.data); setPrivacy(r.data.allowedPrivacyLevels[0] ?? 'SELF_ONLY'); } }).catch(() => { if (live) setConfig(null); });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (config?.enabled) void load(); }, [config?.enabled, load]);
  const active = posts.some((p) => IN_PROGRESS.includes(p.status));
  useEffect(() => {
    if (!config?.enabled || !active) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [config?.enabled, active, load]);

  if (!config?.enabled) return null;

  const submit = async () => {
    if (!file || !caption.trim() || busy) return;
    setBusy(true); setProgress(0);
    // One id per submission: a double click or a retried request cannot create a second post.
    requestId.current ??= crypto.randomUUID();
    try {
      const uploaded = await mediaApi.upload(file, setProgress);
      await tiktokPublishingApi.create({ channelId, mediaKey: uploaded.data.fileKey, caption: caption.trim(), privacyLevel: privacy, idempotencyKey: requestId.current });
      toast.success('Queued. The video will be sent to TikTok shortly.');
      setFile(null); setCaption(''); requestId.current = null;
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not queue this video. Try again.'));
    } finally { setBusy(false); setProgress(null); }
  };

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast.success(done); await load(); } catch (e) { toast.error(errorMessage(e, 'That did not work. Refresh and try again.')); }
  };

  return (
    <section aria-label="Post a video to TikTok" className="mt-4 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <h4 className="text-xs font-bold text-gray-800">Post a video</h4>
      {config.allowedPrivacyLevels.length === 1 && config.allowedPrivacyLevels[0] === 'SELF_ONLY' && (
        <p className="mt-1 text-[11px] text-gray-500">Until TikTok approves this app for public posting, videos can only be posted as &ldquo;Only me&rdquo;.</p>
      )}
      {canPost ? (
        <div className="mt-3 space-y-2.5">
          <label className="block text-[11px] font-medium text-gray-600">
            Video (MP4, MOV or WebM)
            <input type="file" accept={ACCEPTED} disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); requestId.current = null; }}
              className="mt-1 block w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold" />
          </label>
          <label className="block text-[11px] font-medium text-gray-600">
            Caption
            <textarea value={caption} maxLength={config.maxCaption} disabled={busy} onChange={(e) => { setCaption(e.target.value); requestId.current = null; }} rows={3}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400" />
            <span className="text-[10px] text-gray-400">{caption.length}/{config.maxCaption}</span>
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-medium text-gray-600">
              Who can watch
              <select value={privacy} disabled={busy || config.allowedPrivacyLevels.length < 2} onChange={(e) => setPrivacy(e.target.value)}
                className="mt-1 block rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
                {config.allowedPrivacyLevels.map((p) => <option key={p} value={p}>{PRIVACY[p] ?? p}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void submit()} disabled={busy || !file || !caption.trim()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50">
              {busy ? (progress !== null && progress < 100 ? `Uploading ${progress}%` : 'Queuing…') : 'Post to TikTok'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-gray-500">Only workspace admins can post videos.</p>
      )}

      <div className="mt-4" aria-live="polite">
        {posts.length === 0 ? (
          <p className="text-[11px] text-gray-400">No videos posted from VerzChat yet.</p>
        ) : (
          <ul className="space-y-2">
            {posts.slice(0, 8).map((p) => (
              <li key={p.id} className="rounded-lg border border-gray-100 bg-white p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-medium text-gray-800">{p.caption}</p>
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', STATUS[p.status].tone)}>{STATUS[p.status].label}</span>
                </div>
                {p.lastError && <p className="mt-1 text-[11px] text-gray-500">{p.lastError}</p>}
                {canPost && (
                  <div className="mt-1.5 flex gap-3">
                    {p.status === 'QUEUED' && <button type="button" className="text-[11px] font-semibold text-gray-500 hover:text-red-600" onClick={() => void act(() => tiktokPublishingApi.cancel(p.id), 'Cancelled')}>Cancel</button>}
                    {(p.status === 'FAILED' || p.status === 'NEEDS_RECONNECT') && <button type="button" className="text-[11px] font-semibold text-slate-700 hover:underline" onClick={() => void act(() => tiktokPublishingApi.retry(p.id), 'Queued again')}>Try again</button>}
                    {p.status === 'UNCERTAIN' && (
                      <button type="button" className="text-[11px] font-semibold text-slate-700 hover:underline"
                        onClick={() => { if (window.confirm('Open TikTok and check that this video is not on the account. Post it again?')) void act(() => tiktokPublishingApi.retry(p.id, true), 'Queued again'); }}>
                        I checked, post again
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
