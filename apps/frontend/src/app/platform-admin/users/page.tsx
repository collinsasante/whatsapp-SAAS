'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Ban, RefreshCw, LogOut } from 'lucide-react';
import { adminUsersApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface PlatformUser {
  id: string; email: string; name: string; role: string;
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
  tenant: { id: string; name: string; plan: string; isActive: boolean };
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'text-rose-400', ADMIN: 'text-violet-400', AGENT: 'text-blue-400', VIEWER: 'text-gray-400',
};

export default function UsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminUsersApi.list({
        page, limit: 25,
        search: search || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
      });
      const data = res.data as { data: PlatformUser[]; total: number; pages: number };
      setUsers(data.data);
      setTotal(data.total);
      setPages(data.pages);
    } catch { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const act = async (id: string, action: 'suspend' | 'reactivate' | 'force-logout') => {
    const user = users.find((u) => u.id === id);
    if (action === 'suspend' && user && !window.confirm(`Suspend user "${user.email}"?`)) return;
    setActionLoading(`${id}_${action}`);
    try {
      if (action === 'suspend') await adminUsersApi.suspend(id);
      else if (action === 'reactivate') await adminUsersApi.reactivate(id);
      else await adminUsersApi.forceLogout(id);
      toast.success(`User ${action === 'force-logout' ? 'logged out' : action + 'd'}`);
      void load();
    } catch { toast.error('Action failed'); }
    finally { setActionLoading(null); }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-bold">Users</h1>
          <p className="text-gray-500 text-sm mt-0.5">{total.toLocaleString()} total users across all workspaces</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-xl pl-9 pr-3 py-2 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:border-transparent" />
        </div>
        {(['all', 'active', 'suspended'] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors capitalize',
              statusFilter === s ? 'bg-rose-950 text-rose-400 border-rose-900' : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600')}>
            {s}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['User', 'Workspace', 'Role', 'Status', 'Last login', 'Actions'].map((h) => (
                  <th key={h} className={cn('px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider', h === 'Actions' ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-12">
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <div className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                </td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-gray-600 text-sm">No users found</td></tr>
              ) : users.map((u) => (
                <tr key={u.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-gray-800 rounded-full flex items-center justify-center text-gray-400 text-[10px] font-bold flex-shrink-0">
                        {u.name?.slice(0, 2).toUpperCase() ?? 'U'}
                      </div>
                      <div>
                        <p className="text-white text-xs font-semibold">{u.name}</p>
                        <p className="text-gray-600 text-[10px]">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-300 text-xs">{u.tenant.name}</p>
                    <p className="text-gray-600 text-[10px] capitalize">{u.tenant.plan}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-medium', ROLE_COLORS[u.role] ?? 'text-gray-400')}>
                      {u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.isActive ? (
                      <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 size={10} />Active</span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle size={10} />Suspended</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { void act(u.id, 'force-logout'); }} disabled={!!actionLoading}
                        className="p-1.5 text-gray-500 hover:text-amber-400 hover:bg-amber-950/40 rounded-lg transition-colors disabled:opacity-30" title="Force logout">
                        {actionLoading === `${u.id}_force-logout` ? <div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" /> : <LogOut size={12} />}
                      </button>
                      {u.isActive ? (
                        <button onClick={() => { void act(u.id, 'suspend'); }} disabled={!!actionLoading}
                          className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition-colors disabled:opacity-30" title="Suspend user">
                          {actionLoading === `${u.id}_suspend` ? <div className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" /> : <Ban size={12} />}
                        </button>
                      ) : (
                        <button onClick={() => { void act(u.id, 'reactivate'); }} disabled={!!actionLoading}
                          className="p-1.5 text-gray-500 hover:text-emerald-400 hover:bg-emerald-950/40 rounded-lg transition-colors disabled:opacity-30" title="Reactivate user">
                          {actionLoading === `${u.id}_reactivate` ? <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" /> : <RefreshCw size={12} />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-gray-600 text-xs">Page {page} of {pages} · {total.toLocaleString()} users</p>
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
