'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Search, Plus, Building2, ChevronRight, AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { platformAdminApi, type Workspace } from '@/lib/platform-admin-api';

const PLAN_COLORS: Record<string, string> = {
  FREE:       'bg-slate-500/15 text-slate-400 border-slate-500/20',
  STARTER:    'bg-teal-500/15 text-teal-400 border-teal-500/20',
  GROWTH:     'bg-blue-500/15 text-blue-400 border-blue-500/20',
  PRO:        'bg-blue-500/15 text-blue-400 border-blue-500/20',
  ENTERPRISE: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
};

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<string | null>(null);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await platformAdminApi.listWorkspaces({
        page, limit: LIMIT,
        search: search || undefined,
        status: status === 'all' ? undefined : status,
      });
      setWorkspaces(res.data.data);
      setTotal(res.data.total);
    } catch { /* handled by interceptor */ }
    finally { setLoading(false); }
  }, [page, search, status]);

  useEffect(() => { void load(); }, [load]);

  async function suspend(id: string) {
    const reason = prompt('Suspension reason:');
    if (!reason) return;
    setActing(id);
    try { await platformAdminApi.suspendWorkspace(id, reason); await load(); }
    finally { setActing(null); }
  }

  async function reactivate(id: string) {
    setActing(id);
    try { await platformAdminApi.reactivateWorkspace(id); await load(); }
    finally { setActing(null); }
  }

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Workspaces</h1>
          <p className="text-slate-500 text-sm mt-0.5">{total.toLocaleString()} total</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search workspaces…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-teal-500/40 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'active', 'suspended'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-2 rounded-xl text-sm font-medium capitalize transition-colors ${
                status === s ? 'bg-teal-500/15 text-teal-300 border border-teal-500/25' : 'bg-white/4 text-slate-400 hover:text-white border border-white/8'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {['Workspace', 'Plan', 'Users', 'Status', 'Created', ''].map(h => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : workspaces.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                    <Building2 size={32} className="mx-auto mb-2 opacity-30" />
                    No workspaces found
                  </td>
                </tr>
              ) : workspaces.map(ws => (
                <tr key={ws.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-4">
                    <div>
                      <p className="text-white font-medium">{ws.name}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{ws.slug}</p>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${PLAN_COLORS[ws.plan] ?? PLAN_COLORS['FREE']}`}>
                      {ws.plan}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-400">{ws._count?.users ?? '—'}</td>
                  <td className="px-5 py-4">
                    {ws.isActive ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-medium">
                        <CheckCircle size={12} /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-400 text-xs font-medium">
                        <XCircle size={12} /> Suspended
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-500 text-xs whitespace-nowrap">
                    {new Date(ws.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <Link href={`/platform-admin/workspaces/${ws.id}`} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/8 transition-colors">
                        <ChevronRight size={14} />
                      </Link>
                      {ws.isActive ? (
                        <button
                          onClick={() => suspend(ws.id)}
                          disabled={acting === ws.id}
                          className="px-2.5 py-1 rounded-lg text-amber-400 hover:bg-amber-500/10 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => reactivate(ws.id)}
                          disabled={acting === ws.id}
                          className="px-2.5 py-1 rounded-lg text-teal-400 hover:bg-teal-500/10 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/8">
            <p className="text-slate-500 text-xs">Page {page} of {pages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/8 text-slate-400 hover:text-white rounded-lg disabled:opacity-40 transition-colors">
                Prev
              </button>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/8 text-slate-400 hover:text-white rounded-lg disabled:opacity-40 transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
