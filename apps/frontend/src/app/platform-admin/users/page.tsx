'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, Ban, RefreshCw, LogOut, Users } from 'lucide-react';
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
  free: 'bg-slate-100 text-slate-500 border-slate-200',
  FREE: 'bg-slate-100 text-slate-500 border-slate-200',
  pro: 'bg-blue-50 text-blue-700 border-blue-200',
  PRO: 'bg-blue-50 text-blue-700 border-blue-200',
  business: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  BUSINESS: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
  ENTERPRISE: 'bg-purple-50 text-purple-700 border-purple-200',
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
      toast.success(`User ${action === 'force-logout' ? 'logged out' : action + 'd'}`);
      void load();
    } catch { toast.error('Action failed'); }
    finally { setActionLoading(null); }
  };

  const pageNumbers = () => {
    const nums = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(pages, page + 2);
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Users</h1>
          <p className="text-slate-500 text-sm mt-0.5">All users across all workspaces</p>
        </div>
        <span className="bg-indigo-50 text-indigo-700 text-sm font-semibold px-3 py-1 rounded-full border border-indigo-100">
          {total.toLocaleString()} total
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl pl-9 pr-3 py-2 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
          />
        </div>
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
          {(['all', 'active', 'suspended'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize',
                statusFilter === s ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                {['User', 'Workspace', 'Role', 'Status', 'Last Login', 'Actions'].map((h) => (
                  <th key={h} className={cn('px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider', h === 'Actions' ? 'text-right' : 'text-left')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <div className="flex items-center justify-center gap-2 text-slate-400">
                      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading users…</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Users size={24} className="text-slate-300" />
                      <span className="text-sm">No users found</span>
                    </div>
                  </td>
                </tr>
              ) : users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 text-[10px] font-bold flex-shrink-0">
                        {u.name?.slice(0, 2).toUpperCase() ?? 'U'}
                      </div>
                      <div>
                        <p className="text-slate-800 text-sm font-semibold">{u.name}</p>
                        <p className="text-slate-400 text-xs">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700 text-sm">{u.tenant.name}</p>
                    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border uppercase', PLAN_BADGE[u.tenant.plan] ?? PLAN_BADGE.free)}>
                      {u.tenant.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border capitalize', ROLE_BADGE[u.role] ?? 'bg-slate-100 text-slate-500 border-slate-200')}>
                      {u.role.replace('_', ' ').toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.isActive ? (
                      <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" /> Suspended
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{relativeTime(u.lastLoginAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => { void act(u.id, 'force-logout'); }}
                        disabled={!!actionLoading}
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-30"
                        title="Force logout"
                      >
                        {actionLoading === `${u.id}_force-logout` ? (
                          <div className="w-3.5 h-3.5 border border-amber-500 border-t-transparent rounded-full animate-spin" />
                        ) : <LogOut size={14} />}
                      </button>
                      {u.isActive ? (
                        <button
                          onClick={() => { void act(u.id, 'suspend'); }}
                          disabled={!!actionLoading}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30"
                          title="Suspend user"
                        >
                          {actionLoading === `${u.id}_suspend` ? (
                            <div className="w-3.5 h-3.5 border border-red-500 border-t-transparent rounded-full animate-spin" />
                          ) : <Ban size={14} />}
                        </button>
                      ) : (
                        <button
                          onClick={() => { void act(u.id, 'reactivate'); }}
                          disabled={!!actionLoading}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30"
                          title="Reactivate user"
                        >
                          {actionLoading === `${u.id}_reactivate` ? (
                            <div className="w-3.5 h-3.5 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
                          ) : <RefreshCw size={14} />}
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
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-slate-400 text-xs">
              Page {page} of {pages} · <span className="font-medium text-slate-600">{total.toLocaleString()}</span> users
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              {pageNumbers().map((n) => (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={cn(
                    'w-7 h-7 text-xs font-medium rounded-lg transition-colors',
                    n === page ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100',
                  )}
                >
                  {n}
                </button>
              ))}
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
