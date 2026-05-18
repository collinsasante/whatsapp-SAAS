'use client';
import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Radio, MessageCircle, Instagram, Mail, Globe } from 'lucide-react';
import { adminChannelsApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Channel {
  id: string; type: string; name: string; isActive: boolean; createdAt: string;
  tenant: { id: string; name: string; plan: string };
}

const TYPE_BADGE: Record<string, string> = {
  WHATSAPP: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INSTAGRAM: 'bg-pink-50 text-pink-700 border-pink-200',
  FACEBOOK_MESSENGER: 'bg-blue-50 text-blue-700 border-blue-200',
  TELEGRAM: 'bg-sky-50 text-sky-700 border-sky-200',
  EMAIL: 'bg-orange-50 text-orange-700 border-orange-200',
  TIKTOK: 'bg-slate-100 text-slate-600 border-slate-200',
  WEB_CHAT: 'bg-gray-100 text-gray-600 border-gray-200',
};

const TYPE_DOT: Record<string, string> = {
  WHATSAPP: 'bg-emerald-500',
  INSTAGRAM: 'bg-pink-500',
  FACEBOOK_MESSENGER: 'bg-blue-500',
  TELEGRAM: 'bg-sky-500',
  EMAIL: 'bg-orange-500',
  TIKTOK: 'bg-slate-500',
  WEB_CHAT: 'bg-gray-500',
};

function TypeIcon({ type }: { type: string }) {
  const cls = 'flex-shrink-0';
  if (type === 'WHATSAPP') return <MessageCircle size={14} className={cn(cls, 'text-emerald-600')} />;
  if (type === 'INSTAGRAM') return <Instagram size={14} className={cn(cls, 'text-pink-600')} />;
  if (type === 'EMAIL') return <Mail size={14} className={cn(cls, 'text-orange-500')} />;
  if (type === 'WEB_CHAT') return <Globe size={14} className={cn(cls, 'text-gray-500')} />;
  return <Radio size={14} className={cn(cls, 'text-slate-500')} />;
}

const ALL_TYPES = ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK_MESSENGER', 'TELEGRAM', 'EMAIL', 'WEB_CHAT'];

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminChannelsApi.list({ page, limit: 50, type: typeFilter || undefined });
      const data = res.data as { data: Channel[]; total: number; pages: number };
      setChannels(data.data);
      setTotal(data.total);
      setPages(data.pages);
      // Only recalculate counts when no filter is active (to show global counts)
      if (!typeFilter) {
        const counts: Record<string, number> = {};
        (data.data as Channel[]).forEach((ch) => {
          counts[ch.type] = (counts[ch.type] ?? 0) + 1;
        });
        setTypeCounts(counts);
      }
    } catch { toast.error('Failed to load channels'); }
    finally { setLoading(false); }
  }, [page, typeFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [typeFilter]);

  const activeCount = channels.filter((c) => c.isActive).length;

  const statCards = ALL_TYPES.map((t) => ({ type: t, count: typeCounts[t] ?? 0 }))
    .filter((s) => s.count > 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Channels</h1>
          <p className="text-slate-500 text-sm mt-0.5">All connected channels across workspaces</p>
        </div>
        <span className="bg-indigo-50 text-indigo-700 text-sm font-semibold px-3 py-1 rounded-full border border-indigo-100">
          {total.toLocaleString()} total
        </span>
      </div>

      {/* Stat cards by type */}
      {statCards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
          {statCards.map(({ type, count }) => (
            <button
              key={type}
              onClick={() => setTypeFilter((v) => v === type ? '' : type)}
              className={cn(
                'bg-white rounded-xl p-4 shadow-sm border text-left transition-all hover:shadow-md',
                typeFilter === type ? 'border-indigo-300 ring-2 ring-indigo-500/20' : 'border-slate-200',
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', TYPE_DOT[type] ?? 'bg-slate-400')} />
                <span className="text-slate-500 text-xs font-medium">{type.replace(/_/g, ' ')}</span>
              </div>
              <p className="text-slate-900 text-xl font-bold">{count}</p>
              <p className="text-slate-400 text-[10px] mt-0.5">channels</p>
            </button>
          ))}
        </div>
      )}

      {/* Type filter pills */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={() => setTypeFilter('')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
            !typeFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300',
          )}
        >
          All types
        </button>
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter((v) => v === t ? '' : t)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
              typeFilter === t
                ? (TYPE_BADGE[t] ?? 'bg-slate-100 text-slate-600 border-slate-200')
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300',
            )}
          >
            {t.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Channel</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Workspace</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex items-center justify-center gap-2 text-slate-400">
                      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading channels…</span>
                    </div>
                  </td>
                </tr>
              ) : channels.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Radio size={24} className="text-slate-300" />
                      <span className="text-sm">No channels found</span>
                    </div>
                  </td>
                </tr>
              ) : channels.map((ch) => (
                <tr key={ch.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <TypeIcon type={ch.type} />
                      <p className="text-slate-800 text-sm font-medium">{ch.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase', TYPE_BADGE[ch.type] ?? 'bg-slate-100 text-slate-500 border-slate-200')}>
                      {ch.type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700 text-sm">{ch.tenant.name}</p>
                    <p className="text-slate-400 text-xs uppercase">{ch.tenant.plan}</p>
                  </td>
                  <td className="px-4 py-3">
                    {ch.isActive ? (
                      <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" /> Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(ch.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-slate-400 text-xs">
              Page {page} of {pages} · <span className="font-medium text-slate-600">{total}</span> channels
              {typeFilter && <> · {activeCount} active</>}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
