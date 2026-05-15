'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Radio } from 'lucide-react';
import { adminChannelsApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Channel {
  id: string; type: string; name: string; isActive: boolean; createdAt: string;
  tenant: { id: string; name: string; plan: string };
}

const CHANNEL_ICONS: Record<string, string> = {
  WHATSAPP: '💬', INSTAGRAM: '📸', FACEBOOK_MESSENGER: '💙', TELEGRAM: '✈️', EMAIL: '📧', TIKTOK: '🎵', WEB_CHAT: '🌐',
};

const TYPE_COLORS: Record<string, string> = {
  WHATSAPP: 'text-emerald-400 bg-emerald-950/40 border-emerald-900/50',
  INSTAGRAM: 'text-pink-400 bg-pink-950/40 border-pink-900/50',
  FACEBOOK_MESSENGER: 'text-blue-400 bg-blue-950/40 border-blue-900/50',
  TELEGRAM: 'text-sky-400 bg-sky-950/40 border-sky-900/50',
  EMAIL: 'text-amber-400 bg-amber-950/40 border-amber-900/50',
  TIKTOK: 'text-gray-300 bg-gray-800 border-gray-700',
  WEB_CHAT: 'text-violet-400 bg-violet-950/40 border-violet-900/50',
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminChannelsApi.list({ page, limit: 50, type: typeFilter || undefined });
      const data = res.data as { data: Channel[]; total: number; pages: number };
      setChannels(data.data);
      setTotal(data.total);
      setPages(data.pages);
    } catch { toast.error('Failed to load channels'); }
    finally { setLoading(false); }
  }, [page, typeFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [typeFilter]);

  const activeCount = channels.filter((c) => c.isActive).length;
  const inactiveCount = channels.filter((c) => !c.isActive).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-bold">Channels</h1>
          <p className="text-gray-500 text-sm mt-0.5">{total} total · {activeCount} active · {inactiveCount} inactive</p>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {Object.entries(
          channels.reduce<Record<string, number>>((acc, ch) => {
            acc[ch.type] = (acc[ch.type] ?? 0) + 1;
            return acc;
          }, {})
        ).map(([type, count]) => (
          <button key={type} onClick={() => setTypeFilter((v) => v === type ? '' : type)}
            className={cn('bg-gray-900 border rounded-xl p-3 text-center transition-colors',
              typeFilter === type ? 'border-rose-700' : 'border-gray-800 hover:border-gray-700')}>
            <p className="text-xl mb-1">{CHANNEL_ICONS[type] ?? '📡'}</p>
            <p className="text-white text-sm font-bold">{count}</p>
            <p className="text-gray-600 text-[10px] capitalize">{type.replace('_', ' ').toLowerCase()}</p>
          </button>
        ))}
      </div>

      {typeFilter && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-gray-500 text-xs">Filtering by:</span>
          <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', TYPE_COLORS[typeFilter] ?? 'text-gray-400 bg-gray-800 border-gray-700')}>
            {typeFilter}
          </span>
          <button onClick={() => setTypeFilter('')} className="text-gray-600 hover:text-gray-400 text-xs">Clear</button>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Channel', 'Type', 'Workspace', 'Status', 'Created'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12">
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <div className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                </td></tr>
              ) : channels.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2 text-gray-600">
                    <Radio size={20} className="text-gray-700" />
                    <span className="text-sm">No channels found</span>
                  </div>
                </td></tr>
              ) : channels.map((ch) => (
                <tr key={ch.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base flex-shrink-0">{CHANNEL_ICONS[ch.type] ?? '📡'}</span>
                      <p className="text-white text-xs font-medium">{ch.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', TYPE_COLORS[ch.type] ?? 'text-gray-400 bg-gray-800 border-gray-700')}>
                      {ch.type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-300 text-xs">{ch.tenant.name}</p>
                    <p className="text-gray-600 text-[10px] capitalize">{ch.tenant.plan}</p>
                  </td>
                  <td className="px-4 py-3">
                    {ch.isActive ? (
                      <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 size={10} />Active</span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle size={10} />Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {new Date(ch.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-gray-600 text-xs">Page {page} of {pages} · {total} channels</p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition-colors"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition-colors"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
