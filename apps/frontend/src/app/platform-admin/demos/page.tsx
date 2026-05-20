'use client';
import { useEffect, useState, useCallback } from 'react';
import { Calendar, RefreshCw, ChevronLeft, ChevronRight, MessageSquare, TrendingUp, Clock, CheckCircle2 } from 'lucide-react';
import { adminHttp } from '@/lib/platform-admin-api';

interface DemoRequest {
  id: string;
  fullName: string;
  workEmail: string;
  businessName: string;
  businessType: string;
  companySize: string;
  currentPlatform: string | null;
  preferredDate: string;
  preferredTime: string;
  timezone: string;
  goals: string | null;
  leadScore: number;
  leadTier: string;
  priority: number;
  status: string;
  createdAt: string;
  notes: { id: string; content: string; authorName: string | null; createdAt: string }[];
}

interface DemoStats {
  total: number;
  byStatus: { status: string; _count: { id: number } }[];
  byTier: { leadTier: string; _count: { id: number }; _avg: { leadScore: number | null } }[];
}

const STATUSES = ['new', 'contacted', 'scheduled', 'completed', 'lost', 'cancelled'];
const TIERS = ['enterprise', 'high-intent', 'warm', 'standard'];

const STATUS_STYLES: Record<string, string> = {
  new:        'bg-blue-500/15 text-blue-400 border-blue-500/25',
  contacted:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  scheduled:  'bg-teal-500/15 text-teal-400 border-teal-500/25',
  completed:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  lost:       'bg-red-500/15 text-red-400 border-red-500/25',
  cancelled:  'bg-slate-500/15 text-slate-400 border-slate-500/25',
};

const TIER_STYLES: Record<string, string> = {
  enterprise:   'bg-purple-500/15 text-purple-400',
  'high-intent': 'bg-orange-500/15 text-orange-400',
  warm:          'bg-yellow-500/15 text-yellow-400',
  standard:      'bg-slate-500/15 text-slate-400',
};

const TIER_LABEL: Record<string, string> = {
  enterprise: '🏢 Enterprise',
  'high-intent': '🔥 High-Intent',
  warm: '⭐ Warm',
  standard: 'Standard',
};

export default function DemosPage() {
  const [demos, setDemos] = useState<DemoRequest[]>([]);
  const [stats, setStats] = useState<DemoStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [selected, setSelected] = useState<DemoRequest | null>(null);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState('');

  const LIMIT = 20;

  const loadStats = useCallback(async () => {
    try {
      const { data } = await adminHttp.get('/demos/stats');
      setStats(data);
    } catch {}
  }, []);

  const loadDemos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      if (statusFilter) params.status = statusFilter;
      if (tierFilter) params.tier = tierFilter;
      const { data } = await adminHttp.get('/demos', { params });
      setDemos(data.data);
      setTotal(data.meta.total);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, statusFilter, tierFilter]);

  useEffect(() => { void loadStats(); void loadDemos(); }, [loadStats, loadDemos]);

  async function updateStatus(id: string, status: string) {
    setUpdatingStatus(status);
    try {
      await adminHttp.patch(`/demos/${id}/status`, { status });
      if (selected?.id === id) setSelected((d) => d ? { ...d, status } : d);
      setDemos((ds) => ds.map((d) => d.id === id ? { ...d, status } : d));
      void loadStats();
    } catch {} finally {
      setUpdatingStatus('');
    }
  }

  async function addNote(id: string) {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const { data } = await adminHttp.post(`/demos/${id}/notes`, { content: noteText.trim(), authorName: 'Admin' });
      setSelected((d) => d ? { ...d, notes: [data, ...d.notes] } : d);
      setNoteText('');
    } catch {} finally {
      setAddingNote(false);
    }
  }

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6 lg:p-8 flex gap-6 h-full min-h-0">
      {/* Main list */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Demo Requests</h1>
            <p className="text-slate-500 text-sm mt-0.5">{total} total leads</p>
          </div>
          <button
            onClick={() => { void loadDemos(true); void loadStats(); }}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-slate-400 hover:text-white text-sm transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="bg-white/[0.03] border border-white/8 rounded-xl p-4">
              <p className="text-2xl font-bold text-white">{stats.total}</p>
              <p className="text-xs text-slate-500 mt-0.5">Total requests</p>
            </div>
            {stats.byTier.map((t) => (
              <div key={t.leadTier} className="bg-white/[0.03] border border-white/8 rounded-xl p-4">
                <p className="text-2xl font-bold text-white">{t._count.id}</p>
                <p className="text-xs text-slate-500 mt-0.5">{TIER_LABEL[t.leadTier] ?? t.leadTier}</p>
                {t._avg.leadScore != null && <p className="text-xs text-slate-600 mt-0.5">avg score {Math.round(t._avg.leadScore)}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-teal-500/50"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={tierFilter}
            onChange={(e) => { setTierFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-slate-300 text-sm focus:outline-none focus:border-teal-500/50"
          >
            <option value="">All tiers</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/6">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Lead</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Date</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Tier</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Score</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/4">
                    <td className="px-5 py-4"><div className="h-4 bg-white/6 rounded animate-pulse w-40" /></td>
                    <td className="px-5 py-4 hidden lg:table-cell"><div className="h-4 bg-white/6 rounded animate-pulse w-28" /></td>
                    <td className="px-5 py-4"><div className="h-5 bg-white/6 rounded-full animate-pulse w-20" /></td>
                    <td className="px-5 py-4"><div className="h-4 bg-white/6 rounded animate-pulse w-10" /></td>
                    <td className="px-5 py-4"><div className="h-5 bg-white/6 rounded-full animate-pulse w-20" /></td>
                  </tr>
                ))
              ) : demos.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-600 text-sm">No demo requests found.</td></tr>
              ) : demos.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setSelected(d)}
                  className={`border-b border-white/4 cursor-pointer transition-colors hover:bg-white/[0.03] ${selected?.id === d.id ? 'bg-teal-500/5' : ''}`}
                >
                  <td className="px-5 py-4">
                    <p className="text-white text-sm font-medium">{d.fullName}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{d.businessName}</p>
                  </td>
                  <td className="px-5 py-4 hidden lg:table-cell">
                    <p className="text-slate-300 text-sm">
                      {new Date(d.preferredDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-slate-600 text-xs mt-0.5">{d.preferredTime}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${TIER_STYLES[d.leadTier] ?? 'bg-slate-500/15 text-slate-400'}`}>
                      {TIER_LABEL[d.leadTier] ?? d.leadTier}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-white font-bold text-sm">{d.leadScore}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES[d.status] ?? 'bg-slate-500/15 text-slate-400 border-transparent'}`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-slate-500 text-sm">Page {page} of {pages}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
              ><ChevronLeft size={14} /></button>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
              ><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-80 flex-shrink-0 bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden flex flex-col">
          <div className="p-5 border-b border-white/6">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-white font-bold">{selected.fullName}</p>
                <p className="text-slate-400 text-xs mt-0.5">{selected.workEmail}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-white text-lg leading-none transition-colors">×</button>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2 text-slate-400">
                <TrendingUp size={11} className="text-slate-600" />
                {selected.businessName} · {selected.companySize} people
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Calendar size={11} className="text-slate-600" />
                {new Date(selected.preferredDate).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })} at {selected.preferredTime}
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Clock size={11} className="text-slate-600" />
                {selected.timezone}
              </div>
              {selected.currentPlatform && (
                <div className="flex items-center gap-2 text-slate-400">
                  <MessageSquare size={11} className="text-slate-600" />
                  Currently on {selected.currentPlatform}
                </div>
              )}
            </div>
            {selected.goals && (
              <div className="mt-3 px-3 py-2 bg-white/4 rounded-lg">
                <p className="text-slate-500 text-[10px] uppercase font-semibold mb-1">Goals</p>
                <p className="text-slate-300 text-xs leading-relaxed">{selected.goals}</p>
              </div>
            )}
          </div>

          {/* Status update */}
          <div className="p-4 border-b border-white/6">
            <p className="text-slate-500 text-[10px] uppercase font-semibold mb-2">Update status</p>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(selected.id, s)}
                  disabled={updatingStatus !== '' || selected.status === s}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    selected.status === s
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/30'
                      : 'bg-white/4 text-slate-400 border-white/8 hover:text-white hover:border-white/20'
                  } disabled:opacity-50`}
                >
                  {updatingStatus === s ? '…' : s}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <p className="text-slate-500 text-[10px] uppercase font-semibold">Notes ({selected.notes.length})</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addNote(selected.id); }}
                placeholder="Add a note…"
                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/40"
              />
              <button
                onClick={() => void addNote(selected.id)} disabled={addingNote || !noteText.trim()}
                className="px-3 py-2 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-lg text-xs font-medium hover:bg-teal-500/30 transition-colors disabled:opacity-40"
              >
                {addingNote ? '…' : <CheckCircle2 size={13} />}
              </button>
            </div>
            {selected.notes.map((n) => (
              <div key={n.id} className="bg-white/4 border border-white/6 rounded-lg px-3 py-2">
                <p className="text-slate-300 text-xs leading-relaxed">{n.content}</p>
                <p className="text-slate-600 text-[10px] mt-1.5">
                  {n.authorName ?? 'Admin'} · {new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
