'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { adminApi, type CommerceFeesData } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { StatusBadge, type BadgeTone } from '@/components/admin/Badge';
import { DateRangePicker, rangeForPreset } from '@/components/admin/DateRangePicker';

type Entry = CommerceFeesData['entries'][number];
const TYPE_TONES: Record<string, BadgeTone> = { GMV: 'success', TAKE_RATE: 'info', REFUND_ADJUSTMENT: 'warning' };

export default function CommerceFeeLedgerPage() {
  const [data, setData] = useState<CommerceFeesData | null>(null);
  const [range, setRange] = useState(rangeForPreset('30d', '', ''));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (r: { from: string; to: string }) => {
    setLoading(true);
    try {
      setData(await adminApi.commerceFees(r.from, r.to));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range); }, [load, range]);

  const columns: DataTableColumn<Entry>[] = [
    { key: 'createdAt', header: 'Date', render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: 'tenant', header: 'Tenant', render: (r) => <Link href={`/platform-admin/workspaces/${r.tenantId}`} className="text-teal-600 hover:underline">{r.tenant.name}</Link> },
    { key: 'orderId', header: 'Order', render: (r) => <Link href={`/platform-admin/orders/${r.orderId}`} className="font-mono text-xs text-gray-500 hover:underline">{r.orderId.slice(0, 8)}</Link> },
    { key: 'type', header: 'Type', render: (r) => <StatusBadge status={r.type} map={TYPE_TONES} /> },
    { key: 'amount', header: 'Amount', render: (r) => <span className={r.amountMajorUnits < 0 ? 'text-red-600' : 'text-emerald-600'}>{r.amountMajorUnits > 0 ? '+' : ''}{r.amountMajorUnits.toFixed(2)} {r.currency}</span> },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commerce Fee Ledger</h1>
          <p className="text-gray-500 text-sm mt-1">Cross-tenant GMV/fee/refund entries, most recent 200</p>
        </div>
        <DateRangePicker onChange={setRange} />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {data && data.anomalies.duplicateGmvOrderIds.length > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {data.anomalies.duplicateGmvOrderIds.length} order(s) have more than one GMV entry — worth investigating:{' '}
          {data.anomalies.duplicateGmvOrderIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <Link href={`/platform-admin/orders/${id}`} className="underline font-mono">{id.slice(0, 8)}</Link>
            </span>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={data?.entries ?? []} getRowKey={(r) => r.id} loading={loading} emptyMessage="No ledger entries in this period" />
      </div>
    </div>
  );
}
