'use client';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateTime, formatMoney, ORDER_STATUS, orderRef } from '@/lib/commerce/format';
import type { LedgerRow } from '@/lib/commerce/types';

function numberIn(data: Record<string, unknown> | null, key: string): number | null {
  const v = data?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** What each ledger entry means to the merchant. A refund row shows the money refunded, not the small fee reversal stored as its amount. */
export function describeEntry(e: LedgerRow): { label: string; amount: number; note?: string; tone: 'success' | 'neutral' | 'danger' } {
  if (e.type === 'GMV') return { label: 'Sale', amount: e.amountMajorUnits, tone: 'success' };
  if (e.type === 'TAKE_RATE') return { label: 'Platform fee', amount: -Math.abs(e.amountMajorUnits), tone: 'neutral' };
  const refunded = numberIn(e.data, 'refundAmountMajorUnits');
  const feeBack = numberIn(e.data, 'takeRateClawbackMajorUnits') ?? Math.abs(e.amountMajorUnits);
  return {
    label: 'Refund', amount: -Math.abs(refunded ?? 0), tone: 'danger',
    note: feeBack > 0 ? `Platform fee returned: ${formatMoney(feeBack, e.currency)}` : undefined,
  };
}

export default function TransactionsTable({ rows, busy }: { rows: LedgerRow[]; busy: boolean }) {
  return (
    <div className={cn('overflow-x-auto', busy && 'opacity-60')}>
      <table className="w-full text-sm">
        <caption className="sr-only">Transactions in the selected period</caption>
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Date</th>
            <th scope="col" className="px-4 py-2 font-medium">Order</th>
            <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Customer</th>
            <th scope="col" className="px-4 py-2 font-medium">Type</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Amount</th>
            <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Order status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((e) => {
            const d = describeEntry(e);
            return (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{formatDateTime(e.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-2.5"><Link href={`/commerce/orders?order=${e.orderId}`} className="font-medium text-teal-700 hover:underline">{orderRef(e.orderId)}</Link></td>
                <td className="hidden max-w-[12rem] truncate px-4 py-2.5 text-gray-700 md:table-cell">{e.order.customerName ?? <span className="text-gray-400">Not given</span>}</td>
                <td className="px-4 py-2.5"><StatusBadge tone={d.tone}>{d.label}</StatusBadge>{d.note && <span className="mt-0.5 block text-xs text-gray-500">{d.note}</span>}</td>
                <td className={cn('whitespace-nowrap px-4 py-2.5 text-right tabular-nums', d.amount < 0 ? 'text-red-700' : 'text-gray-900')}>
                  {d.amount < 0 ? '-' : ''}{formatMoney(Math.abs(d.amount), e.currency)}
                </td>
                <td className="hidden px-4 py-2.5 sm:table-cell"><StatusBadge tone={ORDER_STATUS[e.order.status].tone}>{ORDER_STATUS[e.order.status].label}</StatusBadge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
