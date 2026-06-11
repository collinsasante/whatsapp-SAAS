'use client';
import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, Loader2, RefreshCw, AlertCircle, XCircle } from 'lucide-react';
import { adminApi, type Invoice, type CreditPurchase } from '@/lib/admin-api';
import toast from 'react-hot-toast';

function fmt(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [credits, setCredits] = useState<CreditPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.pendingBilling();
      setInvoices(res.invoices);
      setCredits(res.creditPurchases);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activateSub = async (reference: string | null, workspaceName: string) => {
    if (!reference) return toast.error('No reference for this invoice');
    setActing(reference);
    try {
      const res = await adminApi.activateSubscription(reference);
      if (res.alreadyActivated) toast('Already activated', { icon: 'ℹ️' });
      else toast.success(`Subscription activated for ${workspaceName}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const declineSub = async (invoiceId: string, workspaceName: string) => {
    if (!confirm(`Decline payment from ${workspaceName}? This cannot be undone.`)) return;
    setActing(invoiceId);
    try {
      const res = await adminApi.declineInvoice(invoiceId);
      if (res.alreadyHandled) toast('Already handled', { icon: 'ℹ️' });
      else toast.success(`Payment declined for ${workspaceName}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const declineCreditPurchase = async (purchaseId: string, workspaceName: string) => {
    if (!confirm(`Decline credit purchase from ${workspaceName}? This cannot be undone.`)) return;
    setActing(purchaseId);
    try {
      const res = await adminApi.declineCredits(purchaseId);
      if (res.alreadyHandled) toast('Already handled', { icon: 'ℹ️' });
      else toast.success(`Credit purchase declined for ${workspaceName}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const activateCredits = async (reference: string | null, workspaceName: string, credits: number) => {
    if (!reference) return toast.error('No reference for this purchase');
    setActing(reference);
    try {
      const res = await adminApi.activateCredits(reference);
      if (res.alreadyActivated) toast('Already activated', { icon: 'ℹ️' });
      else toast.success(`${credits} credits added to ${workspaceName}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const hasPending = invoices.length > 0 || credits.length > 0;

  return (
    <div className="p-4 sm:p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-gray-500 text-sm mt-1">Pending payments that need activation</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {!loading && !hasPending && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
          <p className="font-medium text-gray-600">All clear</p>
          <p className="text-sm">No pending payments</p>
        </div>
      )}

      {/* Pending Subscriptions */}
      {(loading || invoices.length > 0) && (
        <div>
          <h2 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
            Plan Payments
            {invoices.length > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">{invoices.length}</span>
            )}
          </h2>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Workspace</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Amount</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                  ))
                ) : invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inv.tenant.name}</div>
                      <div className="text-xs text-gray-400">{inv.tenant.billingEmail ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{fmt(inv.total, inv.currency)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{inv.gatewayInvoiceId ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(inv.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => activateSub(inv.gatewayInvoiceId, inv.tenant.name)}
                          disabled={!!acting}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-500 disabled:opacity-50 transition-colors font-medium"
                        >
                          {acting === inv.gatewayInvoiceId ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          Activate
                        </button>
                        <button
                          onClick={() => declineSub(inv.id, inv.tenant.name)}
                          disabled={!!acting}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white rounded-xl border border-gray-100 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors font-medium overflow-hidden"
                        >
                          {acting === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                          Decline
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* Pending Credits */}
      {(loading || credits.length > 0) && (
        <div>
          <h2 className="text-base font-semibold text-gray-800 mb-3 flex items-center gap-2">
            AI Credit Purchases
            {credits.length > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">{credits.length}</span>
            )}
          </h2>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Workspace</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Pack</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Credits</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Amount</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                  ))
                ) : credits.map(cp => (
                  <tr key={cp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{cp.tenant.name}</div>
                      <div className="text-xs text-gray-400">{cp.tenant.billingEmail ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{cp.packSlug}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{cp.credits.toLocaleString()}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{fmt(cp.amount, cp.currency)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{cp.paystackRef ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(cp.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => activateCredits(cp.paystackRef, cp.tenant.name, cp.credits)}
                          disabled={!!acting}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-500 disabled:opacity-50 transition-colors font-medium"
                        >
                          {acting === cp.paystackRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          Add Credits
                        </button>
                        <button
                          onClick={() => declineCreditPurchase(cp.id, cp.tenant.name)}
                          disabled={!!acting}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white rounded-xl border border-gray-100 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors font-medium overflow-hidden"
                        >
                          {acting === cp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                          Decline
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {!loading && hasPending && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <AlertCircle className="w-3.5 h-3.5" />
          Activating a subscription is irreversible. Verify payment receipt before clicking Activate.
        </div>
      )}
    </div>
  );
}
