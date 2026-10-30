'use client';
import Link from 'next/link';
import { formatMoney, formatNumber, formatShare } from '@/lib/analytics/format';
import { METRICS } from '@/lib/analytics/metrics';
import type { IntelligenceResponse } from '@/lib/analytics/types';
import { DeltaBadge, EmptyNote, InfoTip, Panel } from './ui';

export default function RevenueSection({ data }: { data: IntelligenceResponse }) {
  const { current: c, previous: p } = data;

  const legend = (
    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-gray-600">
      <div><dt className="font-semibold text-gray-900">Measured</dt><dd>Orders paid through Commerce, counted from order records.</dd></div>
      <div><dt className="font-semibold text-gray-900">Attributed</dt><dd>Orders linked to the conversation they came from.</dd></div>
      <div><dt className="font-semibold text-gray-900">Not measured</dt><dd>Sales made outside VerzChat, and any estimate of revenue from message counts.</dd></div>
    </dl>
  );

  if (!data.coverage.orders) {
    return (
      <Panel className="p-5 space-y-4">
        <EmptyNote title="Revenue and conversion are not tracked in this workspace" href="/commerce/orders" hrefLabel="Open Commerce orders">
          VerzChat reports revenue only from orders created in Commerce. No orders exist yet, so nothing is shown rather than an estimate. Customer and conversation growth are in the sections above.
        </EmptyNote>
        {legend}
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      {c.orders.byCurrency.length === 0 ? (
        <EmptyNote title="No orders were paid in this period">Orders appear here the day they are paid.</EmptyNote>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-6">
          {c.orders.byCurrency.map((o) => {
            const before = p.orders.byCurrency.find((x) => x.currency === o.currency);
            return (
              <li key={o.currency}>
                <p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5">{o.currency} revenue <InfoTip definition={METRICS.revenue} /></p>
                <p className="text-3xl font-semibold text-gray-900 tabular-nums mt-1">{formatMoney(o.revenue, o.currency)}</p>
                <p className="text-sm text-gray-600 mt-1 tabular-nums">
                  {formatNumber(o.paidOrders)} paid {o.paidOrders === 1 ? 'order' : 'orders'}, average {formatMoney(o.revenue / o.paidOrders, o.currency)}
                </p>
                <p className="mt-1"><DeltaBadge current={o.revenue} previous={before?.revenue ?? 0} direction="higher-is-better" /></p>
              </li>
            );
          })}
        </ul>
      )}
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-6 pt-5 border-t border-gray-100">
        <div>
          <dt className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5">Conversations that led to an order <InfoTip definition={METRICS.orderConversion} /></dt>
          <dd className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{formatShare(c.orders.conversationsWithPaidOrder, c.conversations.total)}</dd>
          <dd className="text-xs text-gray-500 mt-1">{c.orders.conversationsWithPaidOrder} of {c.conversations.total} conversations opened in this period</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500">Refunded orders</dt>
          <dd className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{formatNumber(c.orders.refunded)}</dd>
          <dd className="text-xs text-gray-500 mt-1">Paid in this period and since refunded. Not counted as revenue.</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500">Leads converted</dt>
          <dd className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{data.coverage.leads ? formatShare(c.leads.converted, c.leads.created) : 'n/a'}</dd>
          <dd className="text-xs text-gray-500 mt-1">{data.coverage.leads ? `${c.leads.converted} of ${c.leads.created} leads created in this period` : 'No leads recorded'}</dd>
        </div>
      </dl>
      <div className="mt-6 pt-5 border-t border-gray-100 space-y-3">
        {legend}
        <Link href="/commerce/revenue" className="inline-block text-sm font-medium text-teal-700 hover:underline">Open Commerce revenue</Link>
      </div>
    </Panel>
  );
}
