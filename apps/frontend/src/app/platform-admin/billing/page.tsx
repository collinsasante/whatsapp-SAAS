'use client';
import { useEffect, useState, useCallback } from 'react';
import { Receipt } from 'lucide-react';
import { adminApi, type Invoice } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { useAutoRefresh } from '../_hooks/useAutoRefresh';
import { LiveBadge } from '../_components/LiveBadge';

function fmt(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

const STATUS_META: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-700',
  OPEN: 'bg-amber-100 text-amber-700',
  DRAFT: 'bg-gray-100 text-gray-500',
  VOID: 'bg-gray-100 text-gray-400',
  UNCOLLECTIBLE: 'bg-red-100 text-red-600',
};

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (p = page) => {
    setRefreshing(true);
    try {
      const res = await adminApi.allInvoices(p);
      setInvoices(res.invoices);
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page]);

  useEffect(() => { void load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { secondsAgo, refresh } = useAutoRefresh(() => load(page));

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-4 sm:p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-gray-500 text-sm mt-1">Invoices across all workspaces — Stripe and Paystack payments activate subscriptions automatically via webhook</p>
        </div>
        <LiveBadge secondsAgo={secondsAgo} onRefresh={refresh} refreshing={refreshing} />
      </div>

      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-gray-400" />
          Invoices
          {total > 0 && <span className="bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 rounded-full">{total}</span>}
        </h2>
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Workspace</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Amount</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Gateway</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                  ))
                ) : invoices.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No invoices yet</td></tr>
                ) : invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inv.tenant.name}</div>
                      <div className="text-xs text-gray-400">{inv.tenant.billingEmail ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{fmt(inv.total, inv.currency)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{inv.gateway ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_META[inv.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(inv.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 mt-3 text-sm">
            <button
              onClick={() => void load(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-gray-400 text-xs">Page {page} of {totalPages}</span>
            <button
              onClick={() => void load(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
