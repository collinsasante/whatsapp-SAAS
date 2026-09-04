'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { adminApi, type AiCreditTransactionRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';
import { StatusBadge, type BadgeTone } from '@/components/admin/Badge';

const LIMIT = 30;
const TYPES = ['PURCHASE', 'BONUS', 'AI_USAGE', 'REFUND', 'ADJUSTMENT'] as const;
const TYPE_TONES: Record<string, BadgeTone> = {
  PURCHASE: 'success', BONUS: 'info', AI_USAGE: 'neutral', REFUND: 'warning', ADJUSTMENT: 'warning',
};

export default function AiCreditTransactionsPage() {
  const [rows, setRows] = useState<AiCreditTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.aiCreditTransactions({ type: type || undefined, limit: LIMIT, offset });
      setRows(res.items);
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [type, offset]);

  useEffect(() => { void load(); }, [load]);

  const columns: DataTableColumn<AiCreditTransactionRow>[] = [
    { key: 'createdAt', header: 'Date', render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: 'tenant', header: 'Tenant', render: (r) => <Link href={`/platform-admin/workspaces/${r.tenantId}`} className="text-teal-600 hover:underline font-medium">{r.tenant.name}</Link> },
    { key: 'type', header: 'Type', render: (r) => <StatusBadge status={r.type} map={TYPE_TONES} /> },
    { key: 'credits', header: 'Credits', render: (r) => <span className={r.credits < 0 ? 'text-red-600' : 'text-emerald-600'}>{r.credits > 0 ? '+' : ''}{r.credits.toLocaleString()}</span> },
    { key: 'balanceAfter', header: 'Balance After', render: (r) => r.balanceAfter.toLocaleString() },
    { key: 'description', header: 'Description', render: (r) => <span className="text-gray-500">{r.description}</span> },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Credit Transactions</h1>
          <p className="text-gray-500 text-sm mt-1">The full cross-tenant AI credit ledger</p>
        </div>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); setOffset(0); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No transactions found" />
        <div className="p-4 border-t border-gray-100">
          <Pagination total={total} limit={LIMIT} offset={offset} onOffsetChange={setOffset} />
        </div>
      </div>
    </div>
  );
}
