'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, Ban, RefreshCw, LogOut, Users, SlidersHorizontal } from 'lucide-react';
import { adminUsersApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface PlatformUser {
  id: string; email: string; name: string; role: string;
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
  tenant: { id: string; name: string; plan: string; isActive: boolean };
}

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-50 text-purple-700 border-purple-200',
  ADMIN: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  AGENT: 'bg-teal-50 text-teal-700 border-teal-100',
  VIEWER: 'bg-slate-100 text-slate-500 border-slate-200',
};

const PLAN_BADGE: Record<string, string> = {
  FREE: 'bg-slate-100 text-slate-500 border-slate-200',
  free: 'bg-slate-100 text-slate-500 border-slate-200',
  PRO: 'bg-blue-50 text-blue-700 border-blue-200',
  pro: 'bg-blue-50 text-blue-700 border-blue-200',
  BUSINESS: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  business: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ENTERPRISE: 'bg-purple-50 text-purple-700 border-purple-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
};

function relativeTime(date: string | null) {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

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
      toast.success(action === 'force-logout' ? 'User logged out' : `User ${action}d`);
      void load();
    } catch { toast.error('Action failed'); }
    finally { setActionLoading(null); }
  };

  return (
    <div className="p-7 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-slate-400 text-sm mt-0.5">All users across every workspace on the platform</p>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2">
          <Users size={14} className="text-blue-500" />
          <span className="text-blue-700 text-sm font-bold">{total.toLocaleString()}</span>
          <span className="text-blue-400 text-xs">users</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-5 flex flex-wrap items-center gap-3">
        <SlidersHorizontal size={13} className="text-slate-400 flex-shrink-0" />
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg pl-8 pr-3 py-1.5 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
          {(['all', 'active', 'suspended'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize',
                statusFilter === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {(search || statusFilter !== 'all') && (
          <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="text-slate-400 hover:text-slate-600 text-xs transition-colors">
            Clear
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">User</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Workspace</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Last Login</th>
                <th className="text-right px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <div className="flex items-center justify-center gap-2 text-slate-400">
                      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading…</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-20">
                    <Users size={28} className="text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">No users found</p>
                  </td>
                </tr>
              ) : users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors group">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 text-[10px] font-bold flex-shrink-0">
                        {u.name?.slice(0, 2).toUpperCase() ?? 'U'}
                      </div>
                      <div>
                        <p className="text-slate-800 text-sm font-semibold leading-tight">{u.name}</p>
                        <p className="text-slate-400 text-xs">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-slate-700 text-sm font-medium">{u.tenant.name}</p>
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide', PLAN_BADGE[u.tenant.plan] ?? PLAN_BADGE.FREE)}>
                      {u.tenant.plan}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize', ROLE_BADGE[u.role] ?? 'bg-slate-100 text-slate-500 border-slate-200')}>
                      {u.role.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {u.isActive ? (
                      <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Suspended
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-xs">{relativeTime(u.lastLoginAt)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { void act(u.id, 'force-logout'); }}
                        disabled={!!actionLoading}
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-30"
                        title="Force logout"
                      >
                        {actionLoading === `${u.id}_force-logout` ? <div className="w-3.5 h-3.5 border border-amber-500 border-t-transparent rounded-full animate-spin" /> : <LogOut size={14} />}
                      </button>
                      {u.isActive ? (
                        <button
                          onClick={() => { void act(u.id, 'suspend'); }}
                          disabled={!!actionLoading}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30"
                          title="Suspend user"
                        >
                          {actionLoading === `${u.id}_suspend` ? <div className="w-3.5 h-3.5 border border-red-500 border-t-transparent rounded-full animate-spin" /> : <Ban size={14} />}
                        </button>
                      ) : (
                        <button
                          onClick={() => { void act(u.id, 'reactivate'); }}
                          disabled={!!actionLoading}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30"
                          title="Reactivate"
                        >
                          {actionLoading === `${u.id}_reactivate` ? <div className="w-3.5 h-3.5 border border-emerald-500 border-t-transparent rounded-full animate-spin" /> : <RefreshCw size={14} />}
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
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-slate-400 text-xs">
              Page <span className="font-medium text-slate-600">{page}</span> of <span className="font-medium text-slate-600">{pages}</span>
              {' · '}<span className="font-medium text-slate-600">{total.toLocaleString()}</span> users
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors">
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                const n = Math.max(1, Math.min(pages - 4, page - 2)) + i;
                return n <= pages ? (
                  <button key={n} onClick={() => setPage(n)} className={cn('w-7 h-7 text-xs font-medium rounded-lg transition-colors', n === page ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100')}>{n}</button>
                ) : null;
              })}
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
