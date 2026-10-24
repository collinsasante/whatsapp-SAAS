'use client';
import Link from 'next/link';
import { adminApi, type AiCreditTransactionRow } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/admin/format';
import { PageHeader } from '@/components/admin/PageHeader';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { StatusPill, type PillTone } from '@/components/admin/StatusPill';
import { EmptyState } from '@/components/admin/States';

const LIMIT = 30;
const TYPES: Array<{ value: string; label: string; tone: PillTone }> = [
  { value: 'PURCHASE', label: 'Purchase', tone: 'success' }, { value: 'BONUS', label: 'Bonus grant', tone: 'info' },
  { value: 'AI_USAGE', label: 'AI usage', tone: 'neutral' }, { value: 'REFUND', label: 'Refund', tone: 'warning' }, { value: 'ADJUSTMENT', label: 'Adjustment', tone: 'warning' },
];

export default function CreditTransactionsPage() {
  const url = useUrlState();
  const type = url.get('type');
  const tenantId = url.get('tenantId');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const offset = (page - 1) * LIMIT;
  const tx = useAdminData(() => adminApi.aiCreditTransactions({ type: type || undefined, tenantId: tenantId || undefined, limit: LIMIT, offset }), [type, tenantId, offset]);
  const data = tx.data;

  const columns: Column<AiCreditTransactionRow>[] = [
    { key: 'when', header: 'When', mobile: 'title', cell: (r) => <time dateTime={r.createdAt} title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</time> },
    { key: 'type', header: 'Type', mobile: 'badge', cell: (r) => { const t = TYPES.find((x) => x.value === r.type); return <StatusPill tone={t?.tone ?? 'neutral'}>{t?.label ?? r.type}</StatusPill>; } },
    { key: 'tenant', header: 'Tenant', mobile: 'line', cell: (r) => <Link href={`/platform-admin/workspaces/${r.tenant.id}?tab=ai`} className="text-teal-700 hover:underline">{r.tenant.name}</Link> },
    { key: 'credits', header: 'Credits', align: 'right', mobile: 'line', cell: (r) => <span className={r.credits < 0 ? 'text-gray-700' : 'text-green-800'}>{r.credits > 0 ? '+' : ''}{formatNumber(r.credits)}</span> },
    { key: 'after', header: 'Balance after', align: 'right', mobile: 'line', cell: (r) => formatNumber(r.balanceAfter) },
    { key: 'description', header: 'Note', cell: (r) => <span className="text-sm text-gray-700">{r.description}</span> },
  ];

  return (
    <div>
      <PageHeader title="Credit transactions" description="Every change to a tenant's AI credit balance: purchases, grants, refunds, adjustments and AI usage." />
      {tenantId && <p className="mb-3 text-sm text-gray-700 bg-gray-100 rounded-md px-3 py-2">Showing one tenant&apos;s transactions. <Link href={`/platform-admin/workspaces/${tenantId}?tab=ai`} className="text-teal-700 hover:underline">Open the tenant</Link> or <button onClick={() => url.set({ tenantId: '' })} className="text-teal-700 hover:underline">show everyone</button>.</p>}
      <FilterBar onClear={() => url.set({ type: '', tenantId: '' })} filters={[{ key: 'type', label: 'Any type', value: type, options: TYPES, onChange: (v) => url.set({ type: v }) }]} />
      <AdminTable caption="Credit transactions" columns={columns} rows={data?.items ?? []} rowKey={(r) => r.id} loading={tx.loading} error={tx.error} onRetry={tx.reload} empty={<EmptyState title="No transactions match" />} />
      {data && data.total > LIMIT && <div className="mt-3"><Pagination total={data.total} limit={LIMIT} offset={offset} onOffsetChange={(o) => url.set({ page: String(o / LIMIT + 1) }, { keepPage: true })} /></div>}
    </div>
  );
}
