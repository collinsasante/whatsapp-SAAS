'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Search } from 'lucide-react';
import { adminApi, type OrderRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';
import { StatusBadge, type BadgeTone } from '@/components/admin/Badge';

const LIMIT = 30;
const STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral', AWAITING_APPROVAL: 'warning', PENDING_PAYMENT: 'warning',
  PAID: 'success', FULFILLING: 'info', COMPLETED: 'success', CANCELLED: 'neutral', REFUNDED: 'danger',
};

export default function OrdersPage() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.orders({ search: search || undefined, status: status || undefined, limit: LIMIT, offset });
      setRows(res.items);
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, status, offset]);

  useEffect(() => { void load(); }, [load]);

  const columns: DataTableColumn<OrderRow>[] = [
    { key: 'id', header: 'Order', render: (r) => <Link href={`/platform-admin/orders/${r.id}`} className="text-teal-600 hover:underline font-mono text-xs">{r.id.slice(0, 8)}</Link> },
    { key: 'tenant', header: 'Tenant', render: (r) => <Link href={`/platform-admin/workspaces/${r.tenantId}`} className="text-gray-700 hover:underline">{r.tenant.name}</Link> },
    { key: 'customer', header: 'Customer', render: (r) => r.customerName ?? r.customerPhone },
    { key: 'total', header: 'Total', render: (r) => `${r.currency} ${r.totalMajorUnits.toFixed(2)}` },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} map={STATUS_TONES} /> },
    { key: 'createdAt', header: 'Created', render: (r) => new Date(r.createdAt).toLocaleDateString() },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-500 text-sm mt-1">Every managed-commerce order across all tenants</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
              placeholder="Customer name/phone…"
              className="pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <option value="">All statuses</option>
            {Object.keys(STATUS_TONES).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No orders found" />
        <div className="p-4 border-t border-gray-100">
          <Pagination total={total} limit={LIMIT} offset={offset} onOffsetChange={setOffset} />
        </div>
      </div>
    </div>
  );
}
