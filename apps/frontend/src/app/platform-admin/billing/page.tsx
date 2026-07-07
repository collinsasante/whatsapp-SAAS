'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Receipt, AlertTriangle, TrendingUp, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { adminApi, type Invoice, type RevenueData } from '@/lib/admin-api';
import toast from 'react-hot-toast';
import { useAutoRefresh } from '../_hooks/useAutoRefresh';
import { LiveBadge } from '../_components/LiveBadge';

const GATEWAY_COLORS: Record<string, string> = {
  STRIPE: '#635bff', PAYSTACK: '#00c3f7', FLUTTERWAVE: '#f5a623', MOMO: '#ffc801',
};

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
  const [revenue, setRevenue] = useState<RevenueData | null>(null);

  const load = useCallback(async (p = page) => {
    setRefreshing(true);
    try {
      const [invRes, revRes] = await Promise.all([adminApi.allInvoices(p), adminApi.revenue()]);
      setInvoices(invRes.invoices);
      setTotal(invRes.total);
      setPage(p);
      setRevenue(revRes);
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

      {revenue && (
        <>
          {revenue.alerts.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Payment success rate below 90% in the last 24h</p>
                <div className="text-xs text-red-600 mt-1 space-y-0.5">
                  {revenue.alerts.map((a) => (
                    <div key={a.gateway}>{a.gateway}: {a.successRatePct}% success ({a.sampleSize} payments)</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-teal-600" />Revenue by provider</h2>
              {revenue.revenueByProviderDay.length === 0 ? (
                <p className="text-xs text-gray-400 py-10 text-center">No revenue data in this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={revenue.revenueByProviderDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {Object.keys(GATEWAY_COLORS).map((g) => (
                      <Bar key={g} dataKey={g} stackId="rev" fill={GATEWAY_COLORS[g]} name={g} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Success rate by provider</h2>
              {revenue.successRateByProvider.length === 0 ? (
                <p className="text-xs text-gray-400 py-10 text-center">No payment data in this period</p>
              ) : (
                <div className="space-y-3">
                  {revenue.successRateByProvider.map((s) => (
                    <div key={s.gateway}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{s.gateway}</span>
                        <span className={s.successRatePct != null && s.successRatePct < 90 ? 'text-red-600 font-medium' : 'text-gray-500'}>
                          {s.successRatePct != null ? `${s.successRatePct}%` : '—'} ({s.successCount}/{s.successCount + s.failedCount})
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s.successRatePct != null && s.successRatePct < 90 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${s.successRatePct ?? 0}%` }} />
                      </div>
                    </div>
                  ))}
                  {revenue.failureReasons.length > 0 && (
                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-500 mb-1.5">Failure reasons this period</p>
                      {revenue.failureReasons.map((f) => (
                        <div key={`${f.gateway}-${f.reason}`} className="flex justify-between text-xs text-gray-500">
                          <span>{f.gateway} · {f.reason}</span><span>{f.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />Dunning worklist
                {revenue.pastDueWorklist.length > 0 && <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">{revenue.pastDueWorklist.length}</span>}
              </h2>
              {revenue.pastDueWorklist.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">No past-due subscriptions</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {revenue.pastDueWorklist.map((t) => (
                    <Link key={t.tenantId} href={`/platform-admin/workspaces/${t.tenantId}`} className="flex items-center justify-between text-xs bg-gray-50 hover:bg-gray-100 rounded-lg px-3 py-2 transition-colors">
                      <span className="font-medium text-gray-700 hover:text-teal-600">{t.tenantName}</span>
                      <span className="text-red-500">{t.daysOverdue}d overdue · {t.currency} {t.amount}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Upcoming renewals</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{revenue.upcomingRenewals.in7Days}</div>
                  <div className="text-xs text-gray-500">next 7 days</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{revenue.upcomingRenewals.in30Days}</div>
                  <div className="text-xs text-gray-500">next 30 days</div>
                </div>
              </div>
              {revenue.revenueByPlan.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-1.5" title="Attributed to each tenant's current plan, not the plan active at time of payment">Revenue by plan (this period)</p>
                  {revenue.revenueByPlan.map((p) => (
                    <div key={p.plan} className="flex justify-between text-xs text-gray-600">
                      <span>{p.plan}</span><span className="font-medium">{p.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

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
