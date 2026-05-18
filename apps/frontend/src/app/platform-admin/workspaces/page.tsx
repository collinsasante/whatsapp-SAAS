'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Building2, ChevronLeft, ChevronRight, Eye, UserCheck,
  Ban, RefreshCw, AlertCircle, SlidersHorizontal,
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

const PLAN_BADGE: Record<string, { label: string; className: string }> = {
  FREE:       { label: 'Free',       className: 'bg-slate-100 text-slate-500 border-slate-200' },
  free:       { label: 'Free',       className: 'bg-slate-100 text-slate-500 border-slate-200' },
  PRO:        { label: 'Pro',        className: 'bg-blue-50 text-blue-700 border-blue-200' },
  pro:        { label: 'Pro',        className: 'bg-blue-50 text-blue-700 border-blue-200' },
  BUSINESS:   { label: 'Business',   className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  business:   { label: 'Business',   className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ENTERPRISE: { label: 'Enterprise', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  enterprise: { label: 'Enterprise', className: 'bg-purple-50 text-purple-700 border-purple-200' },
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
      toast.success(`"${name}" suspended`);
      void load();
    } catch { toast.error('Failed to suspend'); }
    finally { setActionLoading(null); }
  };

  const handleReactivate = async (id: string, name: string) => {
    setActionLoading(id);
    try {
      await adminWorkspacesApi.reactivate(id);
      toast.success(`"${name}" reactivated`);
      void load();
    } catch { toast.error('Failed to reactivate'); }
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
      localStorage.setItem('pa_impersonating', JSON.stringify({ workspaceId: id, workspaceName: data.workspace.name, adminName: admin?.name ?? 'Admin' }));
      setAuth(
        { id: data.user.id, email: data.user.email, name: data.user.name, role: data.user.role as never, tenantId: data.user.tenantId },
        { id: data.workspace.id, name: data.workspace.name, slug: data.workspace.slug, onboardingCompleted: true },
        data.accessToken,
      );
      window.location.href = '/dashboard';
    } catch { toast.error('Failed to impersonate'); }
    finally { setActionLoading(null); }
  };

  return (
    <div className="p-7 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-2xl font-bold tracking-tight">Workspaces</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage all tenant workspaces on the platform</p>
        </div>
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2">
          <Building2 size={14} className="text-indigo-500" />
          <span className="text-indigo-700 text-sm font-bold">{total.toLocaleString()}</span>
          <span className="text-indigo-400 text-xs">workspaces</span>
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
            placeholder="Search by name or slug…"
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
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 text-slate-600 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All plans</option>
          {['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {(search || statusFilter !== 'all' || planFilter) && (
          <button
            onClick={() => { setSearch(''); setStatusFilter('all'); setPlanFilter(''); }}
            className="text-slate-400 hover:text-slate-600 text-xs transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Workspace</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Owner</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Plan</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Status</th>
                <th className="text-right px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Members</th>
                <th className="text-right px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Conversations</th>
                <th className="text-left px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Created</th>
                <th className="text-right px-5 py-3.5 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <div className="flex items-center justify-center gap-2 text-slate-400">
                      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading…</span>
                    </div>
                  </td>
                </tr>
              ) : workspaces.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-20">
                    <Building2 size={28} className="text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">No workspaces found</p>
                    {(search || planFilter) && <p className="text-slate-400 text-xs mt-1">Try adjusting your filters</p>}
                  </td>
                </tr>
              ) : workspaces.map((ws) => {
                const plan = PLAN_BADGE[ws.plan] ?? PLAN_BADGE.FREE;
                return (
                  <tr key={ws.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors group">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 text-[11px] font-bold flex-shrink-0 border border-indigo-100">
                          {ws.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-slate-800 text-sm font-semibold leading-tight">{ws.name}</p>
                          <p className="text-slate-400 text-xs font-mono">{ws.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {ws.owner ? (
                        <div>
                          <p className="text-slate-700 text-xs font-medium">{ws.owner.name}</p>
                          <p className="text-slate-400 text-xs">{ws.owner.email}</p>
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide', plan.className)}>
                        {plan.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {ws.isActive ? (
                        <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-red-500 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Suspended
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right text-slate-700 text-sm font-medium">{ws._count.users}</td>
                    <td className="px-5 py-3.5 text-right text-slate-700 text-sm font-medium">{ws._count.conversations.toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs">{new Date(ws.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => router.push(`/platform-admin/workspaces/${ws.id}`)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => { void handleImpersonate(ws.id, ws.name); }}
                          disabled={!ws.isActive || !!actionLoading}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-30"
                          title="Impersonate"
                        >
                          {actionLoading === ws.id + '_imp' ? <div className="w-3.5 h-3.5 border border-amber-500 border-t-transparent rounded-full animate-spin" /> : <UserCheck size={14} />}
                        </button>
                        {ws.isActive ? (
                          <button
                            onClick={() => { void handleSuspend(ws.id, ws.name); }}
                            disabled={actionLoading === ws.id}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30"
                            title="Suspend"
                          >
                            {actionLoading === ws.id ? <div className="w-3.5 h-3.5 border border-red-400 border-t-transparent rounded-full animate-spin" /> : <Ban size={14} />}
                          </button>
                        ) : (
                          <button
                            onClick={() => { void handleReactivate(ws.id, ws.name); }}
                            disabled={actionLoading === ws.id}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30"
                            title="Reactivate"
                          >
                            {actionLoading === ws.id ? <div className="w-3.5 h-3.5 border border-emerald-500 border-t-transparent rounded-full animate-spin" /> : <RefreshCw size={14} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-slate-400 text-xs">
              Showing page <span className="font-medium text-slate-600">{page}</span> of <span className="font-medium text-slate-600">{pages}</span>
              {' · '}<span className="font-medium text-slate-600">{total.toLocaleString()}</span> total
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                const n = Math.max(1, Math.min(pages - 4, page - 2)) + i;
                return n <= pages ? (
                  <button key={n} onClick={() => setPage(n)}
                    className={cn('w-7 h-7 text-xs font-medium rounded-lg transition-colors', n === page ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100')}
                  >{n}</button>
                ) : null;
              })}
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

      {!loading && workspaces.length === 0 && search && (
        <div className="flex items-center gap-2 text-slate-400 text-sm justify-center mt-4">
          <AlertCircle size={14} />
          <span>No workspaces match &ldquo;{search}&rdquo;</span>
        </div>
      )}
    </div>
  );
}
