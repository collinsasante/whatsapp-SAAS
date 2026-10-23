'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi, type TenantTableRow } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatDate, formatGhs, formatNumber } from '@/lib/admin/format';
import { PageHeader } from '@/components/admin/PageHeader';
import { FilterBar } from '@/components/admin/FilterBar';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { Pagination } from '@/components/admin/Pagination';
import { StatusPill, TenantStatus } from '@/components/admin/StatusPill';
import { EmptyState } from '@/components/admin/States';
import { Hint } from '@/components/admin/MetricStrip';

const LIMIT = 25;

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' }, { value: 'trial', label: 'Trial' }, { value: 'past_due', label: 'Past due' },
  { value: 'suspended', label: 'Suspended' }, { value: 'churned', label: 'Churned' }, { value: 'no_subscription', label: 'No plan' },
];

const SEGMENT_OPTIONS = [
  { value: 'churn_risk', label: 'Churn risk' }, { value: 'trial_ending_7d', label: 'Trial ending within 7 days' },
  { value: 'high_value', label: 'High value (top 10% by MRR)' }, { value: 'signed_up_this_month', label: 'Signed up this month' },
];

type SortKey = 'name' | 'createdAt' | 'mrr' | 'healthScore';

export default function TenantsPage() {
  const url = useUrlState({ sort: 'createdAt', order: 'desc' });
  const search = url.get('q');
  const status = url.get('status');
  const plan = url.get('plan');
  const segment = url.get('filter');
  const createdFrom = url.get('from');
  const createdTo = url.get('to');
  const sort = url.get('sort') as SortKey;
  const order = url.get('order') as 'asc' | 'desc';
  const offset = (Math.max(1, Number(url.get('page')) || 1) - 1) * LIMIT;

  const query = { search, status: status || undefined, plan: plan || undefined, filter: segment || undefined, createdFrom: createdFrom || undefined, createdTo: createdTo || undefined, sort, order };
  const tenants = useAdminData(() => adminApi.workspaces({ ...query, limit: LIMIT, offset }), [search, status, plan, segment, createdFrom, createdTo, sort, order, offset]);
  const plans = useAdminData(() => adminApi.plans(), []);
  const [exporting, setExporting] = useState(false);

  const onSort = (key: string) => {
    if (key === sort) url.set({ order: order === 'asc' ? 'desc' : 'asc' });
    else url.set({ sort: key, order: key === 'name' ? 'asc' : 'desc' });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await adminApi.exportWorkspacesCsv(query);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = `tenants-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The export failed.');
    } finally { setExporting(false); }
  };

  const columns: Column<TenantTableRow>[] = [
    {
      key: 'name', header: 'Tenant', sortable: true, mobile: 'title',
      cell: (t) => <span>{t.name}<span className="block text-xs font-normal text-gray-500 font-mono" title="Tenant ID">{t.id.slice(0, 8)}{t.country ? ` · ${t.country}` : ''}</span></span>,
    },
    { key: 'status', header: 'Status', mobile: 'badge', cell: (t) => <TenantStatus status={t.status} /> },
    { key: 'plan', header: 'Plan', mobile: 'line', cell: (t) => t.plan ?? <span className="text-gray-400">None</span> },
    { key: 'mrr', header: 'MRR', sortable: true, align: 'right', mobile: 'line', cell: (t) => (t.mrrGhs > 0 ? formatGhs(t.mrrGhs) : <span className="text-gray-400">0</span>) },
    {
      key: 'healthScore', header: 'Health', sortable: true, align: 'right', mobile: 'line',
      cell: (t) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          {t.churnRisk && <StatusPill tone="warning">At risk</StatusPill>}
          <span className="tabular-nums">{t.healthScore}</span>
        </span>
      ),
    },
    { key: 'team', header: 'Team', align: 'right', cell: (t) => formatNumber(t.teammateCount) },
    { key: 'messages', header: 'Messages, 30 days', align: 'right', cell: (t) => formatNumber(t.usage.messagesLast30Days) },
    { key: 'createdAt', header: 'Signed up', sortable: true, mobile: 'line', cell: (t) => formatDate(t.createdAt) },
  ];

  const data = tenants.data;
  const filtersActive = !!(search || status || plan || segment || createdFrom || createdTo);
  const clear = () => url.set({ q: '', status: '', plan: '', filter: '', from: '', to: '' });

  return (
    <div>
      <PageHeader
        title="Tenants"
        description={data ? `${data.total.toLocaleString()} ${data.total === 1 ? 'tenant' : 'tenants'}${filtersActive ? ' match these filters' : ''}.` : 'Every workspace on the platform.'}
        actions={
          <button onClick={exportCsv} disabled={exporting} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600" title="Exports every tenant matching the current filters">
            <Download className="w-4 h-4" aria-hidden="true" />{exporting ? 'Exporting' : 'Export CSV'}
          </button>
        }
      />

      <FilterBar
        search={search} onSearch={(v) => url.set({ q: v })} placeholder="Search name, ID, billing email or member email"
        onClear={clear}
        filters={[
          { key: 'status', label: 'Any status', value: status, options: STATUS_OPTIONS, onChange: (v) => url.set({ status: v }) },
          { key: 'plan', label: 'Any plan', value: plan, options: (plans.data ?? []).map((p) => ({ value: p.slug, label: p.name })), onChange: (v) => url.set({ plan: v }) },
          { key: 'segment', label: 'Any segment', value: segment, options: SEGMENT_OPTIONS, onChange: (v) => url.set({ filter: v }) },
        ]}
        extra={
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <label htmlFor="created-from" className="sr-only">Signed up from</label>
            <input id="created-from" type="date" value={createdFrom} max={createdTo || undefined} onChange={(e) => url.set({ from: e.target.value })} className="py-1.5 px-2 border border-gray-300 rounded-md text-sm bg-white" />
            <span aria-hidden="true">to</span>
            <label htmlFor="created-to" className="sr-only">Signed up until</label>
            <input id="created-to" type="date" value={createdTo} min={createdFrom || undefined} onChange={(e) => url.set({ to: e.target.value })} className="py-1.5 px-2 border border-gray-300 rounded-md text-sm bg-white" />
            <Hint label="Health">Health is a 0 to 100 score from sign-in activity, messaging, broadcasts, team size and payment status. At risk means the subscription is past due, activity fell sharply, or there has been no activity for 14 days.</Hint>
          </div>
        }
      />

      <AdminTable
        caption="Tenants" columns={columns} rows={data?.tenants ?? []} rowKey={(t) => t.id} rowHref={(t) => `/platform-admin/workspaces/${t.id}`}
        loading={tenants.loading} error={tenants.error} onRetry={tenants.reload}
        sortKey={sort} sortOrder={order} onSort={onSort}
        empty={<EmptyState title={filtersActive ? 'No tenants match these filters' : 'No tenants yet'} action={filtersActive ? <button onClick={clear} className="text-sm text-teal-700 hover:underline">Clear the filters</button> : undefined}>{filtersActive ? 'Try removing a filter or searching for something shorter.' : 'Tenants appear here when people sign up.'}</EmptyState>}
      />
      {data && data.total > LIMIT && (
        <div className="mt-3"><Pagination total={data.total} limit={LIMIT} offset={offset} onOffsetChange={(o) => url.set({ page: String(o / LIMIT + 1) }, { keepPage: true })} /></div>
      )}
    </div>
  );
}
