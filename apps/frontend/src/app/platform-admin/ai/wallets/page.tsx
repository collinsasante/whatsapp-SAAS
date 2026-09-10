'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Search } from 'lucide-react';
import { adminApi, type AiCreditWalletRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';

const LIMIT = 30;

export default function AiCreditWalletsPage() {
  const [rows, setRows] = useState<AiCreditWalletRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.aiCreditWallets({ search: search || undefined, limit: LIMIT, offset });
      setRows(res.items);
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, offset]);

  useEffect(() => { void load(); }, [load]);

  const columns: DataTableColumn<AiCreditWalletRow>[] = [
    { key: 'tenantName', header: 'Tenant', render: (r) => <Link href={`/platform-admin/workspaces/${r.tenantId}`} className="text-teal-600 hover:underline font-medium">{r.tenantName}</Link> },
    { key: 'balance', header: 'Balance', render: (r) => r.balance.toLocaleString() },
    { key: 'purchased', header: 'Purchased', render: (r) => r.purchased.toLocaleString() },
    { key: 'bonus', header: 'Bonus', render: (r) => r.bonus.toLocaleString() },
    { key: 'consumed', header: 'Consumed', render: (r) => r.consumed.toLocaleString() },
    { key: 'refunded', header: 'Refunded', render: (r) => r.refunded.toLocaleString() },
    { key: 'adjusted', header: 'Adjusted', render: (r) => r.adjusted.toLocaleString() },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Credit Wallets</h1>
          <p className="text-gray-500 text-sm mt-1">Per-tenant AI credit balances</p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            placeholder="Search tenants…"
            className="pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.tenantId} loading={loading} emptyMessage="No tenants found" />
        <div className="p-4 border-t border-gray-100">
          <Pagination total={total} limit={LIMIT} offset={offset} onOffsetChange={setOffset} />
        </div>
      </div>
    </div>
  );
}
