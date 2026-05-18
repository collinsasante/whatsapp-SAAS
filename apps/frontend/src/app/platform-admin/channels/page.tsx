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

const TYPE_CONFIG: Record<string, { label: string; badge: string; dot: string }> = {
  WHATSAPP:           { label: 'WhatsApp',         badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  INSTAGRAM:          { label: 'Instagram',         badge: 'bg-pink-50 text-pink-700 border-pink-200',         dot: 'bg-pink-500'    },
  FACEBOOK_MESSENGER: { label: 'Facebook',          badge: 'bg-blue-50 text-blue-700 border-blue-200',          dot: 'bg-blue-500'    },
  TELEGRAM:           { label: 'Telegram',          badge: 'bg-sky-50 text-sky-700 border-sky-200',            dot: 'bg-sky-500'     },
  EMAIL:              { label: 'Email',             badge: 'bg-orange-50 text-orange-700 border-orange-200',    dot: 'bg-orange-500'  },
  TIKTOK:             { label: 'TikTok',            badge: 'bg-slate-100 text-slate-600 border-slate-200',      dot: 'bg-slate-500'   },
  WEB_CHAT:           { label: 'Web Chat',          badge: 'bg-gray-100 text-gray-600 border-gray-200',         dot: 'bg-gray-400'    },
};

function TypeIcon({ type }: { type: string }) {
  if (type === 'WHATSAPP') return <MessageCircle size={14} className="text-emerald-600 flex-shrink-0" />;
  if (type === 'INSTAGRAM') return <Instagram size={14} className="text-pink-600 flex-shrink-0" />;
  if (type === 'EMAIL') return <Mail size={14} className="text-orange-500 flex-shrink-0" />;
  if (type === 'WEB_CHAT') return <Globe size={14} className="text-gray-500 flex-shrink-0" />;
  return <Radio size={14} className="text-slate-500 flex-shrink-0" />;
}

const ALL_TYPES = Object.keys(TYPE_CONFIG);

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
      if (!typeFilter) {
        const counts: Record<string, number> = {};
        (data.data as Channel[]).forEach((ch) => { counts[ch.type] = (counts[ch.type] ?? 0) + 1; });
        setTypeCounts(counts);
      }
    } catch { toast.error('Failed to load channels'); }
    finally { setLoading(false); }
  }, [page, typeFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [typeFilter]);

  const statCards = ALL_TYPES.map((t) => ({ type: t, count: typeCounts[t] ?? 0 })).filter((s) => s.count > 0);

  return (
    <div className="p-7 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-2xl font-bold tracking-tight">Channels</h1>
          <p className="text-slate-400 text-sm mt-0.5">All connected channels across every workspace</p>
        </div>
        <div className="flex items-center gap-2 bg-violet-50 border border-violet-100 rounded-xl px-4 py-2">
          <Radio size={14} className="text-violet-500" />
          <span className="text-violet-700 text-sm font-bold">{total.toLocaleString()}</span>
          <span className="text-violet-400 text-xs">channels</span>
        </div>
      </div>

      {/* Channel type summary cards */}
      {statCards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-5">
          {statCards.map(({ type, count }) => {
            const cfg = TYPE_CONFIG[type];
            const isActive = typeFilter === type;
            return (
              <button
                key={type}
                onClick={() => setTypeFilter((v) => v === type ? '' : type)}
                className={cn(
                  'bg-white rounded-xl p-4 border text-left transition-all hover:shadow-sm',
                  isActive ? 'border-indigo-300 ring-2 ring-indigo-500/20 shadow-sm' : 'border-slate-200',
                )}
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg?.dot ?? 'bg-slate-400')} />
                  <TypeIcon type={type} />
                </div>
                <p className="text-slate-900 text-xl font-bold">{count}</p>
                <p className="text-slate-400 text-[10px] font-medium mt-0.5">{cfg?.label ?? type}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Type filter pills */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={() => setTypeFilter('')}
          className={cn('px-3 py-1 text-xs font-medium rounded-full border transition-colors', !typeFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}
        >
          All types
        </button>
        {ALL_TYPES.map((t) => {
          const cfg = TYPE_CONFIG[t];
          return (
            <button
              key={t}
              onClick={() => setTypeFilter((v) => v === t ? '' : t)}
              className={cn('px-3 py-1 text-xs font-medium rounded-full border transition-colors', typeFilter === t ? (cfg?.badge ?? 'bg-slate-100 text-slate-600 border-slate-200') : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}
            >
              {cfg?.label ?? t}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Channel</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Type</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Workspace</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Connected</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-16">
                    <div className="flex items-center justify-center gap-2 text-slate-400">
                      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading…</span>
                    </div>
                  </td>
                </tr>
              ) : channels.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-20">
                    <Radio size={28} className="text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">No channels found</p>
                  </td>
                </tr>
              ) : channels.map((ch) => {
                const cfg = TYPE_CONFIG[ch.type];
                return (
                  <tr key={ch.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <TypeIcon type={ch.type} />
                        <p className="text-slate-800 text-sm font-medium">{ch.name}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide', cfg?.badge ?? 'bg-slate-100 text-slate-500 border-slate-200')}>
                        {cfg?.label ?? ch.type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-slate-700 text-sm font-medium">{ch.tenant.name}</p>
                      <p className="text-slate-400 text-xs uppercase">{ch.tenant.plan}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      {ch.isActive ? (
                        <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs">{new Date(ch.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-slate-400 text-xs">
              Page <span className="font-medium text-slate-600">{page}</span> of <span className="font-medium text-slate-600">{pages}</span>
              {' · '}<span className="font-medium text-slate-600">{total}</span> total
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
