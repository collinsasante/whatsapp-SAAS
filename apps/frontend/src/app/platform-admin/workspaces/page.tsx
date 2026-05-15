'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Building2, ChevronLeft, ChevronRight, CheckCircle2,
  XCircle, AlertCircle, Eye, UserCheck, Ban, RefreshCw,
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

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-800 text-gray-400 border-gray-700',
  starter: 'bg-blue-950 text-blue-400 border-blue-900',
  pro: 'bg-violet-950 text-violet-400 border-violet-900',
  enterprise: 'bg-amber-950 text-amber-400 border-amber-900',
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

  // Reset page when filters change
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

      // Store current admin token for returning
      localStorage.setItem('pa_returning_to', `/platform-admin/workspaces/${id}`);
      localStorage.setItem('pa_impersonating', JSON.stringify({
        workspaceId: id,
        workspaceName: data.workspace.name,
        adminName: admin?.name ?? 'Admin',
      }));

      // Install workspace session
      setAuth(
        { id: data.user.id, email: data.user.email, name: data.user.name, role: data.user.role as never, tenantId: data.user.tenantId },
        { id: data.workspace.id, name: data.workspace.name, slug: data.workspace.slug, onboardingCompleted: true },
        data.accessToken,
      );

      window.location.href = '/dashboard';
    } catch { toast.error('Failed to start impersonation'); }
    finally { setActionLoading(null); }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-bold">Workspaces</h1>
          <p className="text-gray-500 text-sm mt-0.5">{total.toLocaleString()} total workspaces</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workspaces…"
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-xl pl-9 pr-3 py-2 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:border-transparent"
          />
        </div>

        {(['all', 'active', 'suspended'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors capitalize',
              statusFilter === s
                ? 'bg-rose-950 text-rose-400 border-rose-900'
                : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600',
            )}
          >
            {s}
          </button>
        ))}

        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-400 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-600"
        >
          <option value="">All plans</option>
          {['free', 'starter', 'pro', 'enterprise'].map((p) => (
            <option key={p} value={p} className="capitalize">{p}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider">Workspace</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider">Plan</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider">Members</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider">Conversations</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider">Created</th>
                <th className="text-right px-4 py-3 text-gray-500 text-xs font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-600">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                </td></tr>
              ) : workspaces.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-600 text-sm">No workspaces found</td></tr>
              ) : (
                workspaces.map((ws) => (
                  <tr key={ws.id} className="border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 bg-gray-800 border border-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Building2 size={13} className="text-gray-400" />
                        </div>
                        <div>
                          <p className="text-white text-xs font-semibold">{ws.name}</p>
                          <p className="text-gray-600 text-[10px]">{ws.owner?.email ?? ws.billingEmail ?? ws.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize', PLAN_COLORS[ws.plan] ?? PLAN_COLORS.free)}>
                        {ws.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ws.isActive ? (
                        <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 size={11} /> Active</span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle size={11} /> Suspended</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{ws._count.users}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{ws._count.conversations.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {new Date(ws.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => router.push(`/platform-admin/workspaces/${ws.id}`)}
                          className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-950/50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => { void handleImpersonate(ws.id, ws.name); }}
                          disabled={!ws.isActive || actionLoading === ws.id + '_imp'}
                          className="p-1.5 text-gray-500 hover:text-amber-400 hover:bg-amber-950/50 rounded-lg transition-colors disabled:opacity-30"
                          title="Impersonate workspace"
                        >
                          {actionLoading === ws.id + '_imp' ? (
                            <div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <UserCheck size={13} />
                          )}
                        </button>
                        {ws.isActive ? (
                          <button
                            onClick={() => { void handleSuspend(ws.id, ws.name); }}
                            disabled={actionLoading === ws.id}
                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-950/50 rounded-lg transition-colors disabled:opacity-30"
                            title="Suspend workspace"
                          >
                            {actionLoading === ws.id ? <div className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" /> : <Ban size={13} />}
                          </button>
                        ) : (
                          <button
                            onClick={() => { void handleReactivate(ws.id, ws.name); }}
                            disabled={actionLoading === ws.id}
                            className="p-1.5 text-gray-500 hover:text-emerald-400 hover:bg-emerald-950/50 rounded-lg transition-colors disabled:opacity-30"
                            title="Reactivate workspace"
                          >
                            {actionLoading === ws.id ? <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" /> : <RefreshCw size={13} />}
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-gray-600 text-xs">Page {page} of {pages} · {total.toLocaleString()} workspaces</p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 hover:bg-gray-800 rounded-lg transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
