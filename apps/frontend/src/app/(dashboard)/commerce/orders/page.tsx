'use client';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { commerceOrdersApi } from '@/lib/api';
import { useWidget } from '@/lib/dashboard/useWidget';
import { useAuthStore } from '@/store/auth.store';
import { getPermissions } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import StatStrip from '@/components/ui/StatStrip';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import Tabs from '@/components/ui/Tabs';
import { inputClasses, SearchInput, SelectInput } from '@/components/ui/fields';
import OrderPanel from '@/components/commerce/OrderPanel';
import { formatDate, formatMoney, ORDER_STATUS, orderRef } from '@/lib/commerce/format';
import type { Order, OrderStatus } from '@/lib/commerce/types';

const PAGE_SIZE = 20;
type Sort = 'newest' | 'oldest' | 'totalDesc' | 'totalAsc';
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' },
  { value: 'totalDesc', label: 'Total, high to low' }, { value: 'totalAsc', label: 'Total, low to high' },
];
const STATUS_ORDER = Object.keys(ORDER_STATUS) as OrderStatus[];

const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

function itemSummary(o: Order): string {
  if (o.items.length === 0) return 'No items';
  const units = o.items.reduce((n, i) => n + i.quantity, 0);
  const first = o.items[0].productNameSnapshot;
  return o.items.length === 1 ? `${first}${units > 1 ? ` x${units}` : ''}` : `${first} and ${o.items.length - 1} more`;
}

export default function OrdersPage() {
  const role = useAuthStore((s) => s.user?.role);
  const canManage = getPermissions(role).showCommerce;
  const [tab, setTab] = useState<'ALL' | OrderStatus>('ALL');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(1);
  // The Revenue page links here with ?order=<id> to open that order straight away.
  const [openId, setOpenId] = useState<string | null>(useSearchParams()?.get('order') ?? null);

  const orders = useWidget<Order[]>('orders', async (signal) => (await commerceOrdersApi.list(undefined, signal)).data as Order[]);
  const all = useMemo(() => orders.data ?? [], [orders.data]);
  const rangeProblem = from && to && from > to ? 'The start date must be on or before the end date.' : null;

  // Date range and search narrow the whole list first, so the tab counts always describe what a tab would show.
  const inRange = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((o) => {
      if (!rangeProblem) {
        const day = localDay(o.createdAt);
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      if (!q) return true;
      return orderRef(o.id).toLowerCase().includes(q) || (o.customerName ?? '').toLowerCase().includes(q)
        || o.customerPhone.toLowerCase().includes(q) || (o.paystackReference ?? '').toLowerCase().includes(q)
        || o.items.some((i) => i.productNameSnapshot.toLowerCase().includes(q));
    });
  }, [all, query, from, to, rangeProblem]);

  const counts = useMemo(() => {
    const byStatus = new Map<OrderStatus, number>();
    for (const o of inRange) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    return byStatus;
  }, [inRange]);

  const shown = useMemo(() => {
    const rows = tab === 'ALL' ? [...inRange] : inRange.filter((o) => o.status === tab);
    const by: Record<Sort, (a: Order, b: Order) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt), oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      totalDesc: (a, b) => b.totalMajorUnits - a.totalMajorUnits, totalAsc: (a, b) => a.totalMajorUnits - b.totalMajorUnits,
    };
    return rows.sort(by[sort]);
  }, [inRange, tab, sort]);

  const needsYou = (counts.get('AWAITING_APPROVAL') ?? 0);
  const waitingPayment = counts.get('PENDING_PAYMENT') ?? 0;
  const toFulfil = (counts.get('PAID') ?? 0) + (counts.get('FULFILLING') ?? 0);

  const tabs = [{ key: 'ALL', label: 'All', count: inRange.length }, ...STATUS_ORDER.map((s) => ({ key: s, label: ORDER_STATUS[s].label, count: counts.get(s) ?? 0 }))];
  const rows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtering = query.trim() !== '' || from !== '' || to !== '' || tab !== 'ALL';
  const reset = () => { setQuery(''); setFrom(''); setTo(''); setTab('ALL'); setPage(1); };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <PageHeader
          title="Orders"
          description="What customers have ordered, what is waiting on you, and what is paid."
          actions={<Button variant="secondary" onClick={orders.reload} disabled={orders.loading} aria-label="Refresh orders"><RefreshCw size={14} aria-hidden="true" className={cn(orders.loading && 'animate-spin')} />Refresh</Button>}
        />

        {orders.data && (
          <StatStrip label="Order summary" stats={[
            { label: 'Orders', value: inRange.length.toLocaleString(), hint: from || to || query ? 'Matching your filters' : 'All time' },
            { label: 'Needs approval', value: needsYou.toLocaleString(), tone: needsYou > 0 ? 'warn' : 'default', hint: 'Small orders held for you', onSelect: () => { setTab('AWAITING_APPROVAL'); setPage(1); }, selected: tab === 'AWAITING_APPROVAL' },
            { label: 'Awaiting payment', value: waitingPayment.toLocaleString(), hint: 'Payment link sent', onSelect: () => { setTab('PENDING_PAYMENT'); setPage(1); }, selected: tab === 'PENDING_PAYMENT' },
            { label: 'To fulfil', value: toFulfil.toLocaleString(), hint: 'Paid and not yet completed', onSelect: () => { setTab('PAID'); setPage(1); }, selected: tab === 'PAID' || tab === 'FULFILLING' },
          ]} />
        )}

        <section aria-label="Order list" className="rounded-xl border border-gray-200 bg-white">
          <div className="px-3 pt-1"><Tabs tabs={tabs} active={tab} onChange={(k) => { setTab(k as 'ALL' | OrderStatus); setPage(1); }} label="Order status" idPrefix="order-tab" /></div>
          <div className="flex flex-col gap-2 border-b border-gray-200 p-3 lg:flex-row lg:items-center">
            <SearchInput label="Search orders" placeholder="Search by order, customer, phone or item" value={query} onChange={(v) => { setQuery(v); setPage(1); }} className="lg:flex-1" />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-gray-600">From
                <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={cn(inputClasses, 'w-auto')} />
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-600">To
                <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={cn(inputClasses, 'w-auto')} />
              </label>
              <SelectInput label="Sort by" value={sort} onChange={(v) => { setSort(v as Sort); setPage(1); }} options={SORTS} className="w-44" />
            </div>
          </div>
          {rangeProblem && <p role="alert" className="px-4 pt-3 text-sm text-red-700">{rangeProblem}</p>}

          <div role="tabpanel" aria-labelledby={`order-tab-${tab}`}>
            {orders.loading && !orders.data ? (
              <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading orders">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : orders.error && !orders.data ? (
              <div role="alert" className="m-4 flex flex-col items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-4">
                <p className="text-sm font-medium text-gray-900">Orders could not be loaded</p>
                <p className="text-sm text-gray-600">{orders.error}</p>
                <Button size="sm" onClick={orders.reload}>Try again</Button>
              </div>
            ) : all.length === 0 ? (
              <div className="p-4"><EmptyState compact={false} title="No orders yet">Orders appear here when a customer buys through a conversation. Add products first if you have not.</EmptyState></div>
            ) : shown.length === 0 ? (
              <div className="p-4">
                <EmptyState compact={false} title="No orders match">Try a different search, status or date range.</EmptyState>
                {filtering && <div className="mt-3 text-center"><Button variant="secondary" onClick={reset}>Clear filters</Button></div>}
              </div>
            ) : (
              <>
                {orders.error && <p role="alert" className="px-4 pt-3 text-sm text-red-700">Could not refresh the list. {orders.error} <button onClick={orders.reload} className="font-medium underline">Try again</button></p>}
                <div className={cn('overflow-x-auto', orders.loading && 'opacity-60')}>
                  <table className="w-full text-sm">
                    <caption className="sr-only">Orders, {shown.length} shown</caption>
                    <thead className="bg-gray-50 text-left text-xs text-gray-500">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">Order</th>
                        <th scope="col" className="px-4 py-2 font-medium">Customer</th>
                        <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Items</th>
                        <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Date</th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">Total</th>
                        <th scope="col" className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((o) => (
                        <tr key={o.id} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-2.5">
                            <button type="button" onClick={() => setOpenId(o.id)} className="font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">{orderRef(o.id)}</button>
                          </td>
                          <td className="px-4 py-2.5"><span className="block max-w-[14rem] truncate text-gray-900">{o.customerName ?? o.customerPhone}</span>{o.customerName && <span className="block text-xs text-gray-500">{o.customerPhone}</span>}</td>
                          <td className="hidden px-4 py-2.5 text-gray-600 lg:table-cell"><span className="block max-w-[16rem] truncate">{itemSummary(o)}</span></td>
                          <td className="hidden whitespace-nowrap px-4 py-2.5 text-gray-600 sm:table-cell">{formatDate(o.createdAt)}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-900">{formatMoney(o.totalMajorUnits, o.currency)}</td>
                          <td className="px-4 py-2.5"><StatusBadge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onChange={setPage} noun="orders" />
              </>
            )}
          </div>
        </section>
      </div>
      <OrderPanel orderId={openId} canManage={canManage} onClose={() => setOpenId(null)} onChanged={orders.reload} />
    </div>
  );
}
