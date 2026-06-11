'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronRight, CreditCard } from 'lucide-react';
import { adminApi, type Workspace, type Plan } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { useAutoRefresh } from '../_hooks/useAutoRefresh';
import { LiveBadge } from '../_components/LiveBadge';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  TRIAL: 'bg-sky-100 text-sky-700',
  PAST_DUE: 'bg-amber-100 text-amber-700',
  SUSPENDED: 'bg-red-100 text-red-700',
  CANCELED: 'bg-gray-100 text-gray-500',
  EXPIRED: 'bg-gray-100 text-gray-500',
};

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [setPlanFor, setSetPlanFor] = useState<Workspace | null>(null);
  const [selectedPlanSlug, setSelectedPlanSlug] = useState('');
  const [settingPlan, setSettingPlan] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await adminApi.workspaces(page, query);
      setWorkspaces(res.tenants);
      setTotal(res.total);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, query]);

  const { secondsAgo, refresh } = useAutoRefresh(load);
  useEffect(() => { adminApi.plans().then(setPlans).catch(() => {}); }, []);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); setQuery(search); };

  const confirmSetPlan = async () => {
    if (!setPlanFor || !selectedPlanSlug) return;
    setSettingPlan(true);
    try {
      const res = await adminApi.forceSubscription(setPlanFor.id, selectedPlanSlug);
      toast.success(`${setPlanFor.name} upgraded to ${res.plan}`);
      setSetPlanFor(null);
      setSelectedPlanSlug('');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSettingPlan(false);
    }
  };

  const toggleActive = async (w: Workspace) => {
    setActing(w.id);
    try {
      if (w.isActive) {
        await adminApi.suspendWorkspace(w.id);
        toast.success(`${w.name} suspended`);
      } else {
        await adminApi.activateWorkspace(w.id);
        toast.success(`${w.name} activated`);
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
          <p className="text-gray-500 text-sm mt-1">{total} total</p>
        </div>
        <LiveBadge secondsAgo={secondsAgo} onRefresh={refresh} refreshing={refreshing} />
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 transition-colors">Search</button>
      </form>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500">Workspace</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Users</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">AI Credits</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
              ))
            ) : workspaces.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No workspaces found</td></tr>
            ) : workspaces.map(w => (
              <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{w.name}</div>
                  <div className="text-xs text-gray-400">{w.billingEmail ?? '—'}</div>
                </td>
                <td className="px-4 py-3">
                  {w.subscription ? (
                    <div>
                      <div className="font-medium text-gray-700">{w.subscription.plan.name}</div>
                      <div className="text-xs text-gray-400">{w.subscription.cycle}</div>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-700">{w._count.users}</td>
                <td className="px-4 py-3 text-gray-700">{w.aiCredits}</td>
                <td className="px-4 py-3">
                  {(() => {
                    if (!w.isActive) return (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Suspended</span>
                    );
                    if (w.subscription) return (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[w.subscription.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {w.subscription.status.charAt(0) + w.subscription.status.slice(1).toLowerCase().replace('_', ' ')}
                      </span>
                    );
                    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">No Plan</span>;
                  })()}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(w.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setSetPlanFor(w); setSelectedPlanSlug(w.subscription?.plan ? plans.find(p => p.name === w.subscription?.plan.name)?.slug ?? '' : ''); }}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      <CreditCard className="w-3 h-3" /> Set Plan
                    </button>
                    <button
                      onClick={() => toggleActive(w)}
                      disabled={acting === w.id}
                      className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        w.isActive
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                      } disabled:opacity-50`}
                    >
                      {acting === w.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : w.isActive ? (
                        <XCircle className="w-3 h-3" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3" />
                      )}
                      {w.isActive ? 'Suspend' : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Set Plan Modal */}
      {setPlanFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">Set Plan</h2>
              <p className="text-sm text-gray-500 mt-0.5">Workspace: <span className="font-medium text-gray-700">{setPlanFor.name}</span></p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Select Plan</label>
              <select
                value={selectedPlanSlug}
                onChange={e => setSelectedPlanSlug(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">— choose a plan —</option>
                {plans.map(p => (
                  <option key={p.id} value={p.slug}>{p.name} ({p.slug})</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setSetPlanFor(null); setSelectedPlanSlug(''); }}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => { void confirmSetPlan(); }} disabled={!selectedPlanSlug || settingPlan}
                className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {settingPlan && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
