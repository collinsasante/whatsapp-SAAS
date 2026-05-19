'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, MoreVertical, CheckCircle, Ban, Trash2, ArrowRight, RefreshCw, Loader2 } from 'lucide-react';
import { adminWorkspacesApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';

type Plan = 'starter' | 'growth' | 'pro' | 'enterprise';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  isActive: boolean;
  billingEmail: string | null;
  country: string | null;
  createdAt: string;
  owner: { id: string; email: string; name: string } | null;
  _count: { users: number; conversations: number; messages: number; channels: number; contacts: number };
}

const PLAN_COLORS: Record<Plan, string> = {
  starter: 'bg-slate-700 text-slate-200',
  growth: 'bg-blue-900/60 text-blue-300',
  pro: 'bg-violet-900/60 text-violet-300',
  enterprise: 'bg-amber-900/60 text-amber-300',
};

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function ActionMenu({ ws, onRefresh }: { ws: Workspace; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  async function act(action: string) {
    setOpen(false);
    setLoading(action);
    try {
      if (action === 'suspend') {
        await adminWorkspacesApi.suspend(ws.id, 'Suspended by admin');
        toast.success(`${ws.name} suspended`);
      } else if (action === 'reactivate') {
        await adminWorkspacesApi.reactivate(ws.id);
        toast.success(`${ws.name} reactivated`);
      } else if (action === 'delete') {
        if (!confirm(`Permanently delete "${ws.name}"? This cannot be undone.`)) return;
        await adminWorkspacesApi.delete(ws.id);
        toast.success(`${ws.name} deleted`);
      } else if (action === 'impersonate') {
        const res = await adminWorkspacesApi.impersonate(ws.id);
        const token = res.data.accessToken;
        window.open(`${window.location.origin}/auth/impersonate?token=${token}`, '_blank');
        return;
      }
      onRefresh();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Action failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={14} />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 bg-slate-900 border border-slate-700 rounded-xl py-1.5 w-44 shadow-xl shadow-black/40">
            <button
              onClick={() => router.push(`/admin/workspaces/${ws.id}`)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ArrowRight size={13} /> View detail
            </button>
            {ws.isActive ? (
              <button
                onClick={() => act('suspend')}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-amber-400 hover:bg-slate-800 transition-colors"
              >
                <Ban size={13} /> Suspend
              </button>
            ) : (
              <button
                onClick={() => act('reactivate')}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[#25D366] hover:bg-slate-800 transition-colors"
              >
                <CheckCircle size={13} /> Reactivate
              </button>
            )}
            <button
              onClick={() => act('impersonate')}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-blue-400 hover:bg-slate-800 transition-colors"
            >
              <ArrowRight size={13} /> Sign in as
            </button>
            <div className="border-t border-slate-800 my-1" />
            <button
              onClick={() => act('delete')}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-slate-800 transition-colors"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function WorkspacesPage() {
  const [data, setData] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await adminWorkspacesApi.list({
        page: p, limit: 25,
        ...(search ? { search } : {}),
        ...(plan ? { plan } : {}),
        ...(status ? { status } : {}),
      });
      setData(res.data.data);
      setTotal(res.data.total);
      setPages(res.data.pages);
      setPage(p);
    } catch {
      toast.error('Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, [search, plan, status]);

  useEffect(() => { load(1); }, [load]);

  return (
    <div className="p-8 max-w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Workspaces</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} total</p>
        </div>
        <button
          onClick={() => load(page)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 text-sm transition-colors"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, slug, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(1)}
            className="pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-500 w-64"
          />
        </div>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-slate-500"
        >
          <option value="">All plans</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-slate-500"
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button
          onClick={() => load(1)}
          className="px-3 py-1.5 bg-[#25D366] hover:bg-[#1aad57] text-white text-sm font-medium rounded-lg transition-colors"
        >
          Search
        </button>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Plan</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Members</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Messages</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Channels</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Owner</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500 text-sm">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-slate-600 border-t-[#25D366] rounded-full animate-spin" />
                      Loading workspaces...
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500 text-sm">No workspaces found.</td>
                </tr>
              ) : data.map((ws) => (
                <tr key={ws.id} className="hover:bg-slate-800/30 transition-colors group">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{ws.name}</p>
                    <p className="text-xs text-slate-500">{ws.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${PLAN_COLORS[ws.plan] ?? 'bg-slate-700 text-slate-200'}`}>
                      {ws.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${ws.isActive ? 'text-[#25D366]' : 'text-amber-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ws.isActive ? 'bg-[#25D366]' : 'bg-amber-400'}`} />
                      {ws.isActive ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{ws._count.users}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{fmt(ws._count.messages)}</td>
                  <td className="px-4 py-3 text-slate-300 tabular-nums">{ws._count.channels}</td>
                  <td className="px-4 py-3">
                    {ws.owner ? (
                      <>
                        <p className="text-slate-300 text-xs">{ws.owner.name}</p>
                        <p className="text-slate-600 text-xs">{ws.owner.email}</p>
                      </>
                    ) : (
                      <span className="text-slate-600 text-xs">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {new Date(ws.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <ActionMenu ws={ws} onRefresh={() => load(page)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
            <p className="text-xs text-slate-500">Page {page} of {pages}</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => load(page - 1)}
                disabled={page <= 1}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={() => load(page + 1)}
                disabled={page >= pages}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
