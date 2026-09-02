'use client';

import { useCallback, useEffect, useState } from 'react';
import { Wallet, TrendingUp, Percent, RotateCcw, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { commerceLedgerApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface LedgerEntry {
  id: string;
  orderId: string;
  type: 'GMV' | 'TAKE_RATE' | 'REFUND_ADJUSTMENT';
  amountMajorUnits: number;
  currency: string;
  createdAt: string;
}

interface LedgerResponse {
  entries: LedgerEntry[];
  total: number;
  page: number;
  limit: number;
  totals: Partial<Record<LedgerEntry['type'], number>>;
}

function apiErr(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = err.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || err.message || fallback;
}

const TYPE_STYLE: Record<LedgerEntry['type'], string> = {
  GMV: 'bg-green-50 text-green-600',
  TAKE_RATE: 'bg-violet-50 text-violet-600',
  REFUND_ADJUSTMENT: 'bg-red-50 text-red-600',
};

const TYPE_LABEL: Record<LedgerEntry['type'], string> = {
  GMV: 'Sale',
  TAKE_RATE: 'Platform fee',
  REFUND_ADJUSTMENT: 'Refund',
};

export default function CommerceRevenuePage() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;

  const load = useCallback(async (p: number) => {
    setRefreshing(true);
    try {
      const res = await commerceLedgerApi.get(p, limit);
      setData(res.data as LedgerResponse);
    } catch (e) {
      toast.error(apiErr(e, 'Failed to load revenue'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(page); }, [load, page]);

  const currency = data?.entries[0]?.currency ?? '';
  const gross = data?.totals.GMV ?? 0;
  const fee = Math.abs(data?.totals.TAKE_RATE ?? 0);
  const refunds = Math.abs(data?.totals.REFUND_ADJUSTMENT ?? 0);
  const net = gross - fee - refunds;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
              <Wallet size={18} className="text-green-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Revenue</h1>
              <p className="text-xs text-gray-500">What you&apos;ve sold, what the platform took, and what you actually keep</p>
            </div>
          </div>
          <button
            onClick={() => load(page)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-20 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><TrendingUp size={12} /> Gross sales</div>
                <div className="text-lg font-bold text-gray-900">{currency} {gross.toFixed(2)}</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><Percent size={12} /> Platform fee</div>
                <div className="text-lg font-bold text-violet-600">-{currency} {fee.toFixed(2)}</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><RotateCcw size={12} /> Refunds</div>
                <div className="text-lg font-bold text-red-600">-{currency} {refunds.toFixed(2)}</div>
              </div>
              <div className="bg-green-600 rounded-xl p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-green-100 mb-1"><Wallet size={12} /> Net revenue</div>
                <div className="text-lg font-bold text-white">{currency} {net.toFixed(2)}</div>
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-gray-500 mb-2">Transactions</div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 h-14 animate-pulse" />
                ))}
              </div>
            ) : !data || data.entries.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">
                No revenue yet — a paid order will show up here once a customer completes checkout.
              </div>
            ) : (
              <div className="space-y-2">
                {data.entries.map((entry) => (
                  <div key={entry.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap', TYPE_STYLE[entry.type])}>
                        {TYPE_LABEL[entry.type]}
                      </span>
                      <code className="text-xs text-gray-400 truncate">order {entry.orderId.slice(0, 8)}</code>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={cn('text-sm font-semibold', entry.amountMajorUnits < 0 ? 'text-red-600' : 'text-gray-800')}>
                        {entry.amountMajorUnits < 0 ? '-' : ''}{entry.currency} {Math.abs(entry.amountMajorUnits).toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-400">{new Date(entry.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data && data.total > limit && (
              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors font-medium"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>
                <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors font-medium"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
