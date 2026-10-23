'use client';
import Link from 'next/link';
import { formatMoney, formatNumber } from '@/lib/analytics/format';
import { analyticsHref } from '@/lib/dashboard/format';
import type { DashboardRange, DashboardSummary } from '@/lib/dashboard/types';
import { BarRow, EmptyNote } from '@/components/analytics/ui';

/**
 * Customer and sales view. Money and lead figures appear only for workspaces that really record them: a workspace
 * that never used orders sees an explanation, never a zero that reads as "no sales".
 */
export default function CustomersCard({ data, range }: { data: DashboardSummary; range: DashboardRange }) {
  const { current: c, coverage } = data;
  const total = c.conversations.total;
  const lines = c.orders.byCurrency.filter((o) => o.paidOrders > 0);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Who is writing to you</h3>
        {total === 0 ? (
          <EmptyNote title="No conversations in this period">Customers who write in will be split into new and returning here.</EmptyNote>
        ) : (
          <>
            <ul>
              <BarRow label="New customers" value={c.conversations.newContact} max={total} sub={`${Math.round((c.conversations.newContact / total) * 100)}% of conversations`} />
              <BarRow label="Returning customers" value={c.conversations.returningContact} max={total} tone="bg-slate-600" sub={`${Math.round((c.conversations.returningContact / total) * 100)}% of conversations`} />
            </ul>
            <Link href={analyticsHref(range, 'customers')} className="inline-block mt-2 text-sm font-medium text-teal-700 hover:underline">See customer details</Link>
          </>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Sales</h3>
        {coverage.orders && lines.length > 0 ? (
          <ul className="space-y-1.5">
            {lines.map((o) => (
              <li key={o.currency} className="text-sm text-gray-700">
                <span className="text-lg font-semibold text-gray-900 tabular-nums">{formatMoney(o.revenue, o.currency)}</span>
                <span className="block text-gray-500">{formatNumber(o.paidOrders)} paid {o.paidOrders === 1 ? 'order' : 'orders'} in {o.currency}</span>
              </li>
            ))}
            <li><Link href="/commerce/orders" className="text-sm font-medium text-teal-700 hover:underline">Open orders</Link></li>
          </ul>
        ) : coverage.orders ? (
          <EmptyNote title="No paid orders in this period" href="/commerce/orders" hrefLabel="Open orders">
            Orders paid in this period are added up here, per currency.
          </EmptyNote>
        ) : (
          <EmptyNote title="Sales are not tracked yet" href="/commerce" hrefLabel="Set up Commerce">
            Revenue appears here once you take orders through Commerce. Sales made outside VerzChat are not counted.
          </EmptyNote>
        )}
        {coverage.leads
          ? <p className="text-sm text-gray-700 mt-3"><span className="font-semibold text-gray-900 tabular-nums">{formatNumber(c.leads.qualified)}</span> qualified {c.leads.qualified === 1 ? 'lead' : 'leads'} of {formatNumber(c.leads.created)} created. Leads are scored automatically from the conversation.</p>
          : <p className="text-sm text-gray-500 mt-3">No leads have been recorded yet, so lead figures are not shown.</p>}
      </div>
    </div>
  );
}
