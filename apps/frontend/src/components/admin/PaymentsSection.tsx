'use client';
import Link from 'next/link';
import { adminApi, type PaymentRow } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatDateTime, formatMoney, formatRelative } from '@/lib/admin/format';
import { AdminTable, type Column } from './AdminTable';
import { FilterBar } from './FilterBar';
import { Pagination } from './Pagination';
import { StatusPill, type PillTone } from './StatusPill';
import { EmptyState } from './States';
import { Section } from './PageHeader';

const LIMIT = 20;
const TONE: Record<string, PillTone> = { SUCCEEDED: 'success', FAILED: 'danger', PENDING: 'pending', REFUNDED: 'neutral', DISPUTED: 'warning' };
const STATUSES = ['SUCCEEDED', 'FAILED', 'PENDING', 'REFUNDED', 'DISPUTED'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }));
const GATEWAYS = [{ value: 'STRIPE', label: 'Stripe' }, { value: 'PAYSTACK', label: 'Paystack' }];

/** Individual payments across all providers. Subscription state and payment state are different things; this is the latter. */
export function PaymentsSection() {
  const url = useUrlState();
  const search = url.get('search');
  const status = url.get('status');
  const gateway = url.get('gateway');
  const tenantId = url.get('tenantId');
  const page = Math.max(1, Number(url.get('ppage')) || 1);
  const offset = (page - 1) * LIMIT;

  const payments = useAdminData(() => adminApi.payments({ search: search || undefined, status: status || undefined, gateway: gateway || undefined, tenantId: tenantId || undefined, limit: LIMIT, offset }), [search, status, gateway, tenantId, offset]);
  const data = payments.data;
  const active = !!(search || status || gateway || tenantId);
  const clear = () => url.set({ search: '', status: '', gateway: '', tenantId: '' });

  const columns: Column<PaymentRow>[] = [
    { key: 'createdAt', header: 'When', mobile: 'title', cell: (p) => <time dateTime={p.createdAt} title={formatDateTime(p.createdAt)}>{formatRelative(p.createdAt)}</time> },
    { key: 'status', header: 'Status', mobile: 'badge', cell: (p) => <StatusPill tone={TONE[p.status] ?? 'neutral'}>{p.status.toLowerCase()}</StatusPill> },
    { key: 'tenant', header: 'Tenant', mobile: 'line', cell: (p) => <Link href={`/platform-admin/workspaces/${p.tenant.id}`} className="text-teal-700 hover:underline">{p.tenant.name}</Link> },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'line', cell: (p) => formatMoney(p.amount, p.currency) },
    { key: 'gateway', header: 'Provider', mobile: 'line', cell: (p) => p.gateway },
    { key: 'ref', header: 'Reference', cell: (p) => <span className="font-mono text-xs text-gray-600">{p.gatewayReference ?? 'n/a'}</span> },
    { key: 'reason', header: 'Why it failed', cell: (p) => p.failReason ?? <span className="text-gray-400">None</span> },
  ];

  return (
    <Section title="Payments" id="payments" description={data ? `${data.total.toLocaleString()} ${data.total === 1 ? 'payment' : 'payments'}${active ? ' match these filters' : ''}.` : undefined}>
      {tenantId && <p className="mb-3 text-sm text-gray-700 bg-gray-100 rounded-md px-3 py-2">Showing one tenant&apos;s payments. <button onClick={() => url.set({ tenantId: '' })} className="text-teal-700 hover:underline">Show all</button></p>}
      <FilterBar
        search={search} onSearch={(v) => url.set({ search: v })} placeholder="Search payment ID or provider reference" onClear={clear}
        filters={[
          { key: 'status', label: 'Any status', value: status, options: STATUSES, onChange: (v) => url.set({ status: v }) },
          { key: 'gateway', label: 'Any provider', value: gateway, options: GATEWAYS, onChange: (v) => url.set({ gateway: v }) },
        ]}
      />
      <AdminTable
        caption="Payments" columns={columns} rows={data?.items ?? []} rowKey={(p) => p.id} loading={payments.loading} error={payments.error} onRetry={payments.reload}
        empty={<EmptyState title={active ? 'No payments match these filters' : 'No payments recorded yet'} />}
      />
      {data && data.total > LIMIT && <div className="mt-3"><Pagination total={data.total} limit={LIMIT} offset={offset} onOffsetChange={(o) => url.set({ ppage: String(o / LIMIT + 1) }, { keepPage: true })} /></div>}
    </Section>
  );
}
