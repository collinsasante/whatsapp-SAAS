'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Building2, ChevronLeft, ChevronRight, Eye, UserCheck,
  Ban, RefreshCw, AlertCircle,
} from 'lucide-react';
import { adminWorkspacesApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useAdminStore } from '@/store/admin.store';
import { useAuthStore } from '@/store/auth.store';

interface Workspace {
  id: string; name: string; slug: string; plan: string; isActive: boolean;
  billingEmail: string | null; country: string | null; createdAt: string;
  owner: { id: string; email: string; name: string } | null;
  _count: { users: number; conversations: number; messages: number; channels: number; contacts: number };
}

const PLAN_BADGE: Record<string, string> = {
  free: 'bg-slate-100 text-slate-500 border-slate-200',
  starter: 'bg-blue-50 text-blue-600 border-blue-100',
  pro: 'bg-blue-50 text-blue-700 border-blue-200',
  business: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
  FREE: 'bg-slate-100 text-slate-500 border-slate-200',
  PRO: 'bg-blue-50 text-blue-700 border-blue-200',
  BUSINESS: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ENTERPRISE: 'bg-purple-50 text-purple-700 border-purple-200',
};

export default function WorkspacesPage() {
  const router = useRouter();
  const { admin } = useAdminStore();
  const { setAuth } = useAuthStore();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [planFilter, setPlanFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminWorkspacesApi.list({
        page, limit: 25,
        search: search || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        plan: planFilter || undefined,
      });
      const data = res.data as { data: Workspace[]; total: number; pages: number };
      setWorkspaces(data.data);
      setTotal(data.total);
      setPages(data.pages);
    } catch { toast.error('Failed to load workspaces'); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, planFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter, planFilter]);

  const handleSuspend = async (id: string, name: string) => {
    if (!window.confirm(`Suspend workspace "${name}"? All users will lose access.`)) return;
    setActionLoading(id);
    try {
      await adminWorkspacesApi.suspend(id);
      toast.success(`Workspace "${name}" suspended`);
      void load();
    } catch { toast.error('Failed to suspend workspace'); }
    finally { setActionLoading(null); }
  };

  const handleReactivate = async (id: string, name: string) => {
    setActionLoading(id);
    try {
      await adminWorkspacesApi.reactivate(id);
      toast.success(`Workspace "${name}" reactivated`);
      void load();
    } catch { toast.error('Failed to reactivate workspace'); }
    finally { setActionLoading(null); }
  };

  const handleImpersonate = async (id: string, name: string) => {
    if (!window.confirm(`Enter workspace "${name}" as impersonator? All actions will be logged.`)) return;
    setActionLoading(id + '_imp');
    try {
      const res = await adminWorkspacesApi.impersonate(id);
      const data = res.data as {
        accessToken: string;
        workspace: { id: string; name: string; slug: string; plan: string };
        user: { id: string; email: string; name: string; role: string; tenantId: string };
      };
      localStorage.setItem('pa_returning_to', `/platform-admin/workspaces/${id}`);
      localStorage.setItem('pa_impersonating', JSON.stringify({
        workspaceId: id, workspaceName: data.workspace.name, adminName: admin?.name ?? 'Admin',
      }));
      setAuth(
        { id: data.user.id, email: data.user.email, name: data.user.name, role: data.user.role as never, tenantId: data.user.tenantId },
        { id: data.workspace.id, name: data.workspace.name, slug: data.workspace.slug, onboardingCompleted: true },
        data.accessToken,
      );
      window.location.href = '/dashboard';
    } catch { toast.error('Failed to start impersonation'); }
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
          <h1 className="text-slate-900 text-xl font-bold">Workspaces</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage all tenant workspaces</p>
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
            placeholder="Search workspaces…"
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
                statusFilter === s
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="bg-white border border-slate-200 text-slate-600 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        >
          <option value="">All plans</option>
          {['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Workspace</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Plan</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Members</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Conversations</th>
                <th className="text-left px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Created</th>
                <th className="text-right px-4 py-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-16">
                    <div className="flex items-center justify-center gap-2 text-slate-400">
                      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading workspaces…</span>
                    </div>
                  </td>
                </tr>
              ) : workspaces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Building2 size={24} className="text-slate-300" />
                      <span className="text-sm">No workspaces found</span>
                    </div>
                  </td>
                </tr>
              ) : (
                workspaces.map((ws) => (
                  <tr key={ws.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Building2 size={13} className="text-indigo-500" />
                        </div>
                        <div>
                          <p className="text-slate-800 text-sm font-semibold">{ws.name}</p>
                          <p className="text-slate-400 text-xs">{ws.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase', PLAN_BADGE[ws.plan] ?? PLAN_BADGE.free)}>
                        {ws.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ws.isActive ? (
                        <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" /> Suspended
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-sm">{ws._count.users}</td>
                    <td className="px-4 py-3 text-slate-600 text-sm">{ws._count.conversations.toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{new Date(ws.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => router.push(`/platform-admin/workspaces/${ws.id}`)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => { void handleImpersonate(ws.id, ws.name); }}
                          disabled={!ws.isActive || actionLoading === ws.id + '_imp'}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-30"
                          title="Impersonate workspace"
                        >
                          {actionLoading === ws.id + '_imp' ? (
                            <div className="w-3.5 h-3.5 border border-amber-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <UserCheck size={14} />
                          )}
                        </button>
                        {ws.isActive ? (
                          <button
                            onClick={() => { void handleSuspend(ws.id, ws.name); }}
                            disabled={actionLoading === ws.id}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30"
                            title="Suspend workspace"
                          >
                            {actionLoading === ws.id ? (
                              <div className="w-3.5 h-3.5 border border-red-500 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Ban size={14} />
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => { void handleReactivate(ws.id, ws.name); }}
                            disabled={actionLoading === ws.id}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30"
                            title="Reactivate workspace"
                          >
                            {actionLoading === ws.id ? (
                              <div className="w-3.5 h-3.5 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-slate-400 text-xs">
              Page {page} of {pages} · <span className="font-medium text-slate-600">{total.toLocaleString()}</span> workspaces
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

      {/* Error */}
      {!loading && workspaces.length === 0 && search && (
        <div className="flex items-center gap-2 text-slate-400 text-sm justify-center mt-4">
          <AlertCircle size={14} />
          <span>No workspaces match &ldquo;{search}&rdquo;</span>
        </div>
      )}
    </div>
  );
}
