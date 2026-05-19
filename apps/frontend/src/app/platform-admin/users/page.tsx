'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, Users, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { platformAdminApi, type PlatformUser } from '@/lib/platform-admin-api';
import { formatDistanceToNow } from 'date-fns';

const ROLE_COLORS: Record<string, string> = {
  OWNER:   'bg-amber-500/15 text-amber-400 border-amber-500/20',
  ADMIN:   'bg-purple-500/15 text-purple-400 border-purple-500/20',
  AGENT:   'bg-blue-500/15 text-blue-400 border-blue-500/20',
  VIEWER:  'bg-slate-500/15 text-slate-400 border-slate-500/20',
};

export default function UsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await platformAdminApi.listUsers({ page, limit: LIMIT, search: search || undefined });
      setUsers(res.data.data);
      setTotal(res.data.total);
    } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { void load(); }, [load]);

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-slate-500 text-sm mt-0.5">{total.toLocaleString()} total users</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="relative max-w-sm mb-6">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or email…"
          className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-teal-500/40 transition-colors"
        />
      </div>

      <div className="bg-white/[0.02] border border-white/8 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {['User', 'Role', 'Workspace', 'Status', 'Last Active'].map(h => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                    <Users size={32} className="mx-auto mb-2 opacity-30" />
                    No users found
                  </td>
                </tr>
              ) : users.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-500/15 flex items-center justify-center text-teal-400 text-xs font-bold flex-shrink-0">
                        {u.name?.charAt(0).toUpperCase() ?? '?'}
                      </div>
                      <div>
                        <p className="text-white font-medium">{u.name}</p>
                        <p className="text-slate-500 text-xs">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${ROLE_COLORS[u.role] ?? ROLE_COLORS['AGENT']}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-400 text-xs">{u.tenant?.name ?? '—'}</td>
                  <td className="px-5 py-4">
                    {u.isActive ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle size={11} /> Active</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-400 text-xs"><XCircle size={11} /> Inactive</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-500 text-xs">
                    {u.lastLoginAt ? formatDistanceToNow(new Date(u.lastLoginAt), { addSuffix: true }) : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/8">
            <p className="text-slate-500 text-xs">Page {page} of {pages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/8 text-slate-400 hover:text-white rounded-lg disabled:opacity-40 transition-colors">Prev</button>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/8 text-slate-400 hover:text-white rounded-lg disabled:opacity-40 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
