'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Search, CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronRight, CreditCard, AlertTriangle, ChevronUp, ChevronDown, Download } from 'lucide-react';
import { adminApi, type TenantTableRow, type Plan } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { useAutoRefresh } from '../_hooks/useAutoRefresh';
import { LiveBadge } from '../_components/LiveBadge';

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  trial: 'bg-sky-100 text-sky-700',
  past_due: 'bg-amber-100 text-amber-700',
  suspended: 'bg-red-100 text-red-700',
  churned: 'bg-gray-100 text-gray-500',
  no_subscription: 'bg-gray-100 text-gray-400',
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'churn_risk', label: 'Churn risk' },
  { key: 'trial_ending_7d', label: 'Trial ending in 7 days' },
  { key: 'high_value', label: 'High value (top 10%)' },
  { key: 'signed_up_this_month', label: 'Signed up this month' },
  { key: 'past_due', label: 'Past due' },
];

function healthColor(score: number) {
  if (score >= 70) return 'bg-emerald-100 text-emerald-700';
  if (score >= 40) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

export default function WorkspacesPage() {
  const [tenants, setTenants] = useState<TenantTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<'name' | 'createdAt' | 'mrr' | 'healthScore'>('createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [setPlanFor, setSetPlanFor] = useState<TenantTableRow | null>(null);
  const [selectedPlanSlug, setSelectedPlanSlug] = useState('');
  const [settingPlan, setSettingPlan] = useState(false);
  const [expandedHealthId, setExpandedHealthId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await adminApi.workspaces({ search: query, filter, sort, order, limit, offset });
      setTenants(res.tenants);
      setTotal(res.total);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, filter, sort, order, limit, offset]);

  const { secondsAgo, refresh } = useAutoRefresh(load);
  useEffect(() => { adminApi.plans().then(setPlans).catch(() => {}); }, []);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setOffset(0); setQuery(search); };
  const toggleFilter = (key: string) => { setOffset(0); setFilter((f) => (f === key ? undefined : key)); };
  const toggleSort = (key: typeof sort) => {
    setOffset(0);
    if (sort === key) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setOrder('desc'); }
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await adminApi.exportWorkspacesCsv({ search: query, filter, sort, order });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tenants-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

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

  const toggleActive = async (t: TenantTableRow) => {
    setActing(t.id);
    try {
      if (t.isActive) {
        await adminApi.suspendWorkspace(t.id);
        toast.success(`${t.name} suspended`);
      } else {
        await adminApi.activateWorkspace(t.id);
        toast.success(`${t.name} activated`);
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(offset / limit) + 1;

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: typeof sort }) => (
    <th className="text-left px-4 py-3 font-medium text-gray-500 cursor-pointer select-none" onClick={() => toggleSort(sortKey)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sort === sortKey && (order === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
          <p className="text-gray-500 text-sm mt-1">{total} total</p>
        </div>
        <LiveBadge secondsAgo={secondsAgo} onRefresh={refresh} refreshing={refreshing} />
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
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
        <button
          type="button"
          onClick={() => { void handleExport(); }}
          disabled={exporting}
          className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          title="Export the currently filtered/searched tenant list to CSV"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export CSV
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggleFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              filter === f.key ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <SortHeader label="Workspace" sortKey="name" />
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <SortHeader label="MRR" sortKey="mrr" />
              <th className="text-left px-4 py-3 font-medium text-gray-500">Last payment</th>
              <SortHeader label="Health" sortKey="healthScore" />
              <th className="text-left px-4 py-3 font-medium text-gray-500">Usage (30d)</th>
              <SortHeader label="Signed up" sortKey="createdAt" />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
              ))
            ) : tenants.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No workspaces found</td></tr>
            ) : tenants.map(t => (
              <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/platform-admin/workspaces/${t.id}`} className="font-medium text-gray-900 hover:text-teal-600 hover:underline">{t.name}</Link>
                  <div className="text-xs text-gray-400">{t.billingEmail ?? '—'}{t.country ? ` · ${t.country}` : ''}</div>
                  {t.churnRisk && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-red-600">
                      <AlertTriangle className="w-3 h-3" />Churn risk
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[t.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {statusLabel(t.status)}
                  </span>
                  {t.plan && <div className="text-xs text-gray-400 mt-0.5">{t.plan}</div>}
                </td>
                <td className="px-4 py-3 text-gray-700 font-medium">{t.mrrGhs > 0 ? `GHS ${t.mrrGhs.toFixed(2)}` : '—'}</td>
                <td className="px-4 py-3">
                  {t.lastPayment ? (
                    <div>
                      <span className={`text-xs font-medium ${t.lastPayment.status === 'SUCCEEDED' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {t.lastPayment.status}
                      </span>
                      <div className="text-[10px] text-gray-400">{t.lastPayment.gateway} · {new Date(t.lastPayment.createdAt).toLocaleDateString()}</div>
                    </div>
                  ) : <span className="text-gray-400 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setExpandedHealthId(expandedHealthId === t.id ? null : t.id)}
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${healthColor(t.healthScore)}`}
                    title="Click for breakdown"
                  >
                    {t.healthScore}
                  </button>
                  {expandedHealthId === t.id && (
                    <div className="mt-1.5 text-[10px] text-gray-500 space-y-0.5 bg-gray-50 rounded-lg p-2 w-40">
                      <div>Login activity: {t.healthBreakdown.loginActivity}/25</div>
                      <div>Message activity: {t.healthBreakdown.messageActivity}/25</div>
                      <div>Broadcast activity: {t.healthBreakdown.broadcastActivity}/15</div>
                      <div>Team size: {t.healthBreakdown.teamSize}/15</div>
                      <div>Payment status: {t.healthBreakdown.paymentStatus}/20</div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  <div>{t.usage.conversationsThisMonth} conv.</div>
                  <div>{t.usage.messagesLast30Days} msgs</div>
                  <div>{t.usage.broadcastsThisMonth} broadcasts</div>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setSetPlanFor(t); setSelectedPlanSlug(plans.find(p => p.name === t.plan)?.slug ?? ''); }}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      <CreditCard className="w-3 h-3" /> Set Plan
                    </button>
                    <button
                      onClick={() => toggleActive(t)}
                      disabled={acting === t.id}
                      className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        t.isActive
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                      } disabled:opacity-50`}
                    >
                      {acting === t.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : t.isActive ? (
                        <XCircle className="w-3 h-3" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3" />
                      )}
                      {t.isActive ? 'Suspend' : 'Activate'}
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
            <span className="text-xs text-gray-400">Page {currentPage} of {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setOffset(o => Math.max(0, o - limit))} disabled={currentPage === 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setOffset(o => o + limit)} disabled={currentPage === totalPages}
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
