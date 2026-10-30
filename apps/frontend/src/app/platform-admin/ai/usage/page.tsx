'use client';
import { useState } from 'react';
import Link from 'next/link';
import { adminApi, type AiUsageTopConsumersData } from '@/lib/admin-api';
import { useAdminData } from '@/lib/admin/hooks';
import { formatNumber } from '@/lib/admin/format';
import { PageHeader } from '@/components/admin/PageHeader';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { DateRangePicker, rangeForPreset } from '@/components/admin/DateRangePicker';
import { MetricStrip } from '@/components/admin/MetricStrip';
import { EmptyState } from '@/components/admin/States';

type Row = AiUsageTopConsumersData['items'][number];

export default function AiUsagePage() {
  const [range, setRange] = useState(rangeForPreset('30d', '', ''));
  const usage = useAdminData(() => adminApi.aiUsageTopConsumers(range.from, range.to), [range.from, range.to]);
  const data = usage.data;
  const total = data?.totals.creditsConsumed ?? 0;
  const listed = data ? data.items.reduce((s, r) => s + r.creditsConsumed, 0) : 0;

  const columns: Column<Row>[] = [
    { key: 'tenant', header: 'Tenant', mobile: 'title', cell: (r) => r.tenantName },
    { key: 'credits', header: 'Credits used', align: 'right', mobile: 'badge', cell: (r) => formatNumber(r.creditsConsumed) },
    { key: 'calls', header: 'AI calls', align: 'right', mobile: 'line', cell: (r) => formatNumber(r.aiCalls) },
    {
      key: 'share', header: 'Share of all usage', mobile: 'line',
      cell: (r) => (total > 0 ? (
        <span className="inline-flex items-center gap-2"><span className="w-24 h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true"><span className="block h-full bg-teal-600" style={{ width: `${Math.min(100, (r.creditsConsumed / total) * 100)}%` }} /></span><span className="tabular-nums text-xs text-gray-600">{Math.round((r.creditsConsumed / total) * 100)}%</span></span>
      ) : null),
    },
    { key: 'history', header: '', align: 'right', cell: (r) => <Link href={`/platform-admin/ai/transactions?tenantId=${r.tenantId}`} className="text-sm text-teal-700 hover:underline">History</Link> },
  ];

  return (
    <div>
      <PageHeader title="AI usage by tenant" description="Which tenants use the most Verz AI credits in a period." actions={<DateRangePicker onChange={setRange} />} />
      <div className="mb-4">
        <MetricStrip columns={3} metrics={[
          { label: 'Credits used', value: data ? formatNumber(data.totals.creditsConsumed) : null, unavailable: usage.error ? 'Could not load' : 'Loading', hint: 'Credits consumed by Verz AI across every tenant in the period.' },
          { label: 'AI calls', value: data ? formatNumber(data.totals.aiCalls) : null, unavailable: usage.error ? 'Could not load' : 'Loading' },
          { label: 'Tenants using AI', value: data ? formatNumber(data.totals.tenants) : null, unavailable: usage.error ? 'Could not load' : 'Loading' },
        ]} />
      </div>
      <AdminTable caption="AI usage by tenant" columns={columns} rows={data?.items ?? []} rowKey={(r) => r.tenantId} rowHref={(r) => `/platform-admin/workspaces/${r.tenantId}?tab=ai`} loading={usage.loading} error={usage.error} onRetry={usage.reload} empty={<EmptyState title="No AI usage in this period" />} />
      {data && data.totals.tenants > data.items.length && (
        <p className="text-xs text-gray-500 mt-2">Showing the {data.items.length} heaviest tenants, who account for {total > 0 ? Math.round((listed / total) * 100) : 0}% of usage. The totals above include all {data.totals.tenants}.</p>
      )}
    </div>
  );
}
