'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { adminApi, type AiUsageTopConsumersData } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { DateRangePicker, rangeForPreset } from '@/components/admin/DateRangePicker';

type Row = AiUsageTopConsumersData['items'][number];

export default function AiUsagePage() {
  const [data, setData] = useState<AiUsageTopConsumersData | null>(null);
  const [range, setRange] = useState(rangeForPreset('30d', '', ''));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (r: { from: string; to: string }) => {
    setLoading(true);
    try {
      setData(await adminApi.aiUsageTopConsumers(r.from, r.to));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range); }, [load, range]);

  const columns: DataTableColumn<Row>[] = [
    { key: 'tenantName', header: 'Tenant', render: (r) => <Link href={`/platform-admin/workspaces/${r.tenantId}`} className="text-teal-600 hover:underline font-medium">{r.tenantName}</Link> },
    { key: 'creditsConsumed', header: 'Credits Consumed', render: (r) => r.creditsConsumed.toLocaleString() },
    { key: 'aiCalls', header: 'AI Calls', render: (r) => r.aiCalls.toLocaleString() },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Usage</h1>
          <p className="text-gray-500 text-sm mt-1">Top-20 tenants by AI credit consumption</p>
        </div>
        <DateRangePicker onChange={setRange} />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={data?.items ?? []} getRowKey={(r) => r.tenantId} loading={loading} emptyMessage="No AI usage in this period" />
      </div>
    </div>
  );
}
