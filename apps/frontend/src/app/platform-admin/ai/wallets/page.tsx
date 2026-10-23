'use client';
import Link from 'next/link';
import { adminApi, type AiCreditWalletRow } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatNumber } from '@/lib/admin/format';
import { PageHeader } from '@/components/admin/PageHeader';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { StatusPill } from '@/components/admin/StatusPill';
import { EmptyState } from '@/components/admin/States';

const LIMIT = 30;

export default function CreditWalletsPage() {
  const url = useUrlState();
  const search = url.get('q');
  const filter = url.get('filter') as '' | 'out' | 'low';
  const page = Math.max(1, Number(url.get('page')) || 1);
  const offset = (page - 1) * LIMIT;
  const wallets = useAdminData(() => adminApi.aiCreditWallets({ search: search || undefined, filter: filter || undefined, limit: LIMIT, offset }), [search, filter, offset]);
  const data = wallets.data;
  const low = data?.lowThreshold ?? 100;
  const clear = () => url.set({ q: '', filter: '' });

  const columns: Column<AiCreditWalletRow>[] = [
    { key: 'tenant', header: 'Tenant', mobile: 'title', cell: (r) => r.tenantName },
    {
      key: 'balance', header: 'Balance now', align: 'right', mobile: 'badge',
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          {r.balance <= 0 ? <StatusPill tone="danger">Out of credits</StatusPill> : r.balance < low ? <StatusPill tone="warning">Running low</StatusPill> : null}
          <span className="tabular-nums font-medium">{formatNumber(r.balance)}</span>
        </span>
      ),
    },
    { key: 'purchased', header: 'Bought', align: 'right', mobile: 'line', cell: (r) => formatNumber(r.purchased) },
    { key: 'bonus', header: 'Granted as bonus', align: 'right', mobile: 'line', cell: (r) => formatNumber(r.bonus) },
    { key: 'consumed', header: 'Used', align: 'right', mobile: 'line', cell: (r) => formatNumber(r.consumed) },
    { key: 'refunded', header: 'Refunded', align: 'right', cell: (r) => formatNumber(r.refunded) },
    { key: 'adjusted', header: 'Adjusted', align: 'right', cell: (r) => formatNumber(r.adjusted) },
    { key: 'history', header: '', align: 'right', cell: (r) => <Link href={`/platform-admin/ai/transactions?tenantId=${r.tenantId}`} className="text-sm text-teal-700 hover:underline">History</Link> },
  ];

  return (
    <div>
      <PageHeader title="Credit wallets" description={`Each tenant's AI credits. Verz AI stops replying for a tenant when its balance reaches zero. "Running low" means under ${low} credits. To add credits, open the tenant.`} />
      <FilterBar
        search={search} onSearch={(v) => url.set({ q: v })} placeholder="Search tenants" onClear={clear}
        filters={[{ key: 'filter', label: 'All balances', value: filter, options: [{ value: 'out', label: 'Out of credits' }, { value: 'low', label: `Running low (under ${low})` }], onChange: (v) => url.set({ filter: v }) }]}
      />
      <AdminTable
        caption="Credit wallets" columns={columns} rows={data?.items ?? []} rowKey={(r) => r.tenantId} rowHref={(r) => `/platform-admin/workspaces/${r.tenantId}?tab=ai`}
        loading={wallets.loading} error={wallets.error} onRetry={wallets.reload}
        empty={<EmptyState title={filter === 'out' ? 'No active tenant is out of credits' : filter === 'low' ? 'No active tenant is running low' : 'No tenants found'} />}
      />
      {data && data.total > LIMIT && <div className="mt-3"><Pagination total={data.total} limit={LIMIT} offset={offset} onOffsetChange={(o) => url.set({ page: String(o / LIMIT + 1) }, { keepPage: true })} /></div>}
    </div>
  );
}
