'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReceiptText, X, Loader2, BadgeCheck, RefreshCw } from 'lucide-react';
import { commerceOrdersApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface OrderItem {
  id: string;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  quantity: number;
  unitPriceMajorUnitsSnapshot: number;
  lineTotalMajorUnits: number;
}

interface OrderEvent {
  id: string;
  type: string;
  createdAt: string;
}

interface LedgerEntry {
  id: string;
  type: string;
  amountMajorUnits: number;
  createdAt: string;
}

interface Order {
  id: string;
  status: string;
  customerPhone: string;
  currency: string;
  totalMajorUnits: number;
  paystackReference: string | null;
  paidAt: string | null;
  createdAt: string;
  items?: OrderItem[];
  events?: OrderEvent[];
  ledgerEntries?: LedgerEntry[];
}

function apiErr(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = err.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || err.message || fallback;
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING_PAYMENT: 'bg-amber-50 text-amber-600',
  PAID: 'bg-green-50 text-green-600',
  FULFILLING: 'bg-blue-50 text-blue-600',
  COMPLETED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  REFUNDED: 'bg-red-50 text-red-600',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap', STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600')}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function CommerceOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await commerceOrdersApi.list();
      setOrders(res.data as Order[]);
    } catch (e) {
      toast.error(apiErr(e, 'Failed to load orders'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openOrder = async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await commerceOrdersApi.get(id);
      setSelected(res.data as Order);
    } catch (e) {
      toast.error(apiErr(e, 'Failed to load order'));
    } finally {
      setLoadingDetail(false);
    }
  };

  const verifyPayment = async () => {
    if (!selected) return;
    setVerifying(true);
    try {
      const res = await commerceOrdersApi.verifyPayment(selected.id);
      const data = res.data as { verified: boolean; reason?: string };
      if (data.verified) {
        toast.success('Payment verified with Paystack — order is PAID');
        await openOrder(selected.id);
        await load();
      } else {
        toast.error(data.reason || 'Payment not confirmed by Paystack yet');
      }
    } catch (e) {
      toast.error(apiErr(e, 'Verification failed'));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center">
              <ReceiptText size={18} className="text-amber-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Orders</h1>
              <p className="text-xs text-gray-500">Every order the commerce AI has captured — click one for the full story</p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-2">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-16 animate-pulse" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No orders yet — try the Test Chat page and buy something as a customer.
            </div>
          ) : (
            orders.map(o => (
              <button
                key={o.id}
                onClick={() => openOrder(o.id)}
                className="w-full bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3 hover:shadow-sm hover:border-gray-200 transition-all text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <code className="text-xs text-gray-400 shrink-0">{o.id.slice(0, 8)}</code>
                  <StatusBadge status={o.status} />
                  <span className="text-xs text-gray-400 truncate">{o.customerPhone}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold text-gray-800">{o.currency} {o.totalMajorUnits}</span>
                  <span className="text-xs text-gray-400">{new Date(o.createdAt).toLocaleDateString()}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {(selected || loadingDetail) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">Order {selected ? selected.id.slice(0, 8) : ''}</h3>
                {selected && <StatusBadge status={selected.status} />}
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto">
              {loadingDetail && !selected ? (
                <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
              ) : selected ? (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[11px] text-gray-400">Customer</div>
                      <div className="text-gray-700">{selected.customerPhone}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-400">Created</div>
                      <div className="text-gray-700">{new Date(selected.createdAt).toLocaleString()}</div>
                    </div>
                    {selected.paystackReference && (
                      <div className="col-span-2">
                        <div className="text-[11px] text-gray-400">Paystack reference</div>
                        <code className="text-xs text-gray-600">{selected.paystackReference}</code>
                      </div>
                    )}
                    {selected.paidAt && (
                      <div className="col-span-2">
                        <div className="text-[11px] text-gray-400">Paid at</div>
                        <div className="text-gray-700">{new Date(selected.paidAt).toLocaleString()}</div>
                      </div>
                    )}
                  </div>

                  {selected.items && selected.items.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-2">Items</div>
                      <div className="space-y-1.5">
                        {selected.items.map(item => (
                          <div key={item.id} className="flex items-center justify-between text-sm">
                            <span className="text-gray-700">
                              {item.quantity}× {item.productNameSnapshot}
                              {item.variantLabelSnapshot ? ` (${item.variantLabelSnapshot})` : ''}
                              <span className="text-gray-400"> @ {selected.currency} {item.unitPriceMajorUnitsSnapshot}</span>
                            </span>
                            <span className="text-gray-600">{selected.currency} {item.lineTotalMajorUnits}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between text-sm font-semibold border-t border-gray-100 pt-2">
                          <span className="text-gray-800">Total</span>
                          <span className="text-gray-900">{selected.currency} {selected.totalMajorUnits}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {selected.ledgerEntries && selected.ledgerEntries.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-2">Ledger</div>
                      <div className="space-y-1">
                        {selected.ledgerEntries.map(entry => (
                          <div key={entry.id} className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">{entry.type.replace(/_/g, ' ')}</span>
                            <span className={cn('font-medium', entry.amountMajorUnits < 0 ? 'text-red-600' : 'text-gray-700')}>
                              {selected.currency} {entry.amountMajorUnits}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selected.events && selected.events.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-2">Timeline</div>
                      <div className="space-y-1">
                        {selected.events.map(ev => (
                          <div key={ev.id} className="flex items-center justify-between text-xs">
                            <span className="text-gray-600">{ev.type.replace(/_/g, ' ')}</span>
                            <span className="text-gray-400">{new Date(ev.createdAt).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
            {selected && selected.status === 'PENDING_PAYMENT' && selected.paystackReference && (
              <div className="px-6 py-4 border-t border-gray-100 shrink-0">
                <button
                  onClick={verifyPayment}
                  disabled={verifying}
                  className="flex items-center justify-center gap-1.5 w-full px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 disabled:opacity-50 transition-colors font-medium"
                >
                  {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
                  Verify payment with Paystack
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
