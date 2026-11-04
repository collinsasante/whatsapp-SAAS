'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { tiktokMessagingApi, type TikTokMessagingStatus } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

const errorMessage = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};

/**
 * TikTok direct messages (TikTok Business Messaging API). Shown only for workspaces where the feature is switched on. It states plainly what is still
 * missing; messaging cannot work until TikTok has approved the app, which no screen here can do.
 */
export function TikTokMessagingPanel() {
  const role = useAuthStore((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [status, setStatus] = useState<TikTokMessagingStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setStatus((await tiktokMessagingApi.status()).data); } catch { setStatus(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!status?.flagEnabled) return null;

  const connect = async () => {
    setBusy('connect');
    try { window.location.href = (await tiktokMessagingApi.authorizeUrl()).data.redirectUrl; }
    catch (e) { toast.error(errorMessage(e, 'Could not start the TikTok connection.')); setBusy(null); }
  };
  const importHistory = async (channelId: string) => {
    setBusy(channelId);
    try {
      const r = (await tiktokMessagingApi.importHistory(channelId)).data;
      if (r.error) toast.error(r.error);
      else toast.success(`Imported ${r.messagesImported} earlier message${r.messagesImported === 1 ? '' : 's'}${r.truncated ? ' (more remain; run it again)' : ''}.`);
    } catch (e) { toast.error(errorMessage(e, 'Could not import earlier messages.')); }
    finally { setBusy(null); }
  };

  const ready = status.unmet.length === 0;
  return (
    <section aria-label="TikTok messages" className="mt-4 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <h4 className="text-xs font-bold text-gray-800">Messages</h4>
      <p className="mt-1 text-[11px] text-gray-500">
        Receive and answer TikTok direct messages in your inbox. TikTok lets you reply only after the person writes first, within about {status.limits.replyWindowHours} hours,
        with text or one image.
      </p>

      {!ready && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="status">
          <p className="text-[11px] font-semibold text-amber-800">Not available yet</p>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-800">{status.unmet.map((u) => <li key={u}>{u}</li>)}</ul>
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] font-semibold text-gray-600">What TikTok requires</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-gray-500">{status.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="mt-1 text-[11px] text-gray-500">Webhook address to register with TikTok: <span className="break-all font-mono">{status.webhookUrl}</span></p>
      </details>

      {status.accounts.length > 0 && (
        <ul className="mt-3 space-y-2">
          {status.accounts.map((a) => (
            <li key={a.channelId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white p-2.5">
              <span className="text-xs font-medium text-gray-800">{a.name}</span>
              <span className="flex items-center gap-3">
                <span className={`text-[10px] font-bold ${a.needsReconnect ? 'text-amber-700' : a.isActive ? 'text-green-700' : 'text-gray-500'}`}>
                  {a.needsReconnect ? 'Reconnect needed' : a.isActive ? 'Connected' : 'Disconnected'}
                </span>
                {canManage && ready && a.isActive && !a.needsReconnect && (
                  <button type="button" disabled={busy !== null} onClick={() => void importHistory(a.channelId)}
                    className="text-[11px] font-semibold text-slate-700 hover:underline disabled:opacity-50">
                    {busy === a.channelId ? 'Importing…' : 'Import earlier messages'}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <button type="button" disabled={!ready || busy !== null} onClick={() => void connect()}
          className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
          {busy === 'connect' ? 'Opening TikTok…' : status.accounts.length > 0 ? 'Connect another account' : 'Connect a TikTok business account'}
        </button>
      )}
    </section>
  );
}
