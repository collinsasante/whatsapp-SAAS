'use client';
import { useMemo, useState } from 'react';
import { commerceLedgerApi } from '@/lib/api';
import { useWidget } from '@/lib/dashboard/useWidget';
import { cn } from '@/lib/utils';
import { formatRange } from '@/lib/analytics/format';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import StatStrip, { type Stat } from '@/components/ui/StatStrip';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import Tabs from '@/components/ui/Tabs';
import Toolbar, { customRangeProblem } from '@/components/analytics/Toolbar';
import RevenueChart from '@/components/commerce/RevenueChart';
import TransactionsTable from '@/components/commerce/TransactionsTable';
import { changeSince, csvEscape, formatMoney } from '@/lib/commerce/format';
import type { CurrencyRevenue, LedgerPage, RevenueSummary } from '@/lib/commerce/types';
import type { RangePreset } from '@/lib/analytics/types';

const PAGE_SIZE = 15;

function ChangeNote({ current, previous, noun }: { current: number; previous: number; noun: string }) {
  const change = changeSince(current, previous);
  if (!change) return <>{previous === 0 && current === 0 ? `No ${noun} in either period` : `No ${noun} in the previous period to compare with`}</>;
  if (change.direction === 'flat') return <>Same as the previous period</>;
  return <>{change.direction === 'up' ? 'Up' : 'Down'} {change.percent}% on the previous period</>;
}

function statsFor(c: CurrencyRevenue): Stat[] {
  const { current: now, previous: before } = c;
  const money = (v: number) => formatMoney(v, c.currency);
  return [
    { label: 'Gross sales', value: money(now.gross), hint: <><ChangeNote current={now.gross} previous={before.gross} noun="sales" /><span className="block">{now.paidOrders.toLocaleString()} paid {now.paidOrders === 1 ? 'order' : 'orders'}</span></> },
    { label: 'Refunded', value: money(now.refunded), tone: now.refunded > 0 ? 'warn' : 'default', hint: now.refunds === 0 ? 'No refunds in this period' : `${now.refunds} ${now.refunds === 1 ? 'refund' : 'refunds'}` },
    { label: 'Platform fee', value: money(now.platformFee), hint: now.feeReturned > 0 ? `${money(now.feeCharged)} charged, ${money(now.feeReturned)} returned on refunds` : 'Charged on each sale' },
    { label: 'You keep', value: money(now.net), hint: <ChangeNote current={now.net} previous={before.net} noun="earnings" /> },
  ];
}

export default function RevenuePage() {
  const [preset, setPreset] = useState<RangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [currency, setCurrency] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const customProblem = preset === 'custom' ? customRangeProblem(customFrom, customTo) : null;
  const rangeKey = preset === 'custom' ? `custom:${customFrom}:${customTo}` : preset;
  const summary = useWidget<RevenueSummary>(
    `revenue:${rangeKey}`,
    async (signal) => (await commerceLedgerApi.summary(preset === 'custom' ? { preset, from: customFrom, to: customTo } : { preset }, signal)).data as RevenueSummary,
    { enabled: !customProblem, refreshKey: refresh },
  );
  const meta = summary.data?.meta;
  const chosen = summary.data?.currencies.find((c) => c.currency === currency) ?? summary.data?.currencies[0];

  const ledger = useWidget<LedgerPage | null>(
    `ledger:${meta?.from}:${meta?.to}:${chosen?.currency}:${page}`,
    async (signal) => (await commerceLedgerApi.get({ page, limit: PAGE_SIZE, from: meta!.from, to: meta!.to, currency: chosen!.currency }, signal)).data as LedgerPage,
    { enabled: meta != null && chosen != null, refreshKey: refresh },
  );

  const topSales = useMemo(() => Math.max(0, ...(chosen?.products.top.map((p) => p.sales) ?? [])), [chosen]);

  const exportCsv = () => {
    if (!summary.data || !chosen) return;
    const header = ['Date', `Gross sales (${chosen.currency})`, `Refunded (${chosen.currency})`, `Platform fee (${chosen.currency})`, `You keep (${chosen.currency})`];
    const lines = [header, ...chosen.series.map((p) => [p.date, p.gross.toFixed(2), p.refunded.toFixed(2), p.platformFee.toFixed(2), p.net.toFixed(2)])];
    const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(csvEscape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `revenue-${meta!.from}-to-${meta!.to}-${chosen.currency}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const reload = () => { setRefresh((n) => n + 1); };
  const pickCurrency = (c: string) => { setCurrency(c); setPage(1); };
  const changeRange = (next: RangePreset, from = customFrom, to = customTo) => { setPreset(next); setCustomFrom(from); setCustomTo(to); setPage(1); setCurrency(null); };

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-4">
          <PageHeader
            title="Revenue"
            description={meta ? <>{formatRange(meta.from, meta.to)}, compared with {formatRange(meta.previousFrom, meta.previousTo)} ({meta.timezone})</> : 'What you sold, what was refunded, and what you keep.'}
          />
          <Toolbar
            preset={preset} customFrom={customFrom} customTo={customTo} channel="ALL" showChannel={false}
            loading={summary.loading} refreshLabel="Refresh revenue"
            onPreset={(p) => changeRange(p)} onCustom={(f, t) => changeRange('custom', f, t)} onChannel={() => undefined} onRefresh={reload}
            onExport={chosen ? exportCsv : undefined}
          />
        </header>

        {customProblem ? (
          <p role="alert" className="text-sm text-red-700">{customProblem} Pick a different range to see your revenue.</p>
        ) : summary.loading && !summary.data ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading revenue"><Skeleton className="h-24" /><Skeleton className="h-80" /></div>
        ) : summary.error && !summary.data ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-4">
            <p className="text-sm font-medium text-gray-900">Revenue could not be loaded</p>
            <p className="text-sm text-gray-600">{summary.error}</p>
            <Button size="sm" onClick={summary.reload}>Try again</Button>
          </div>
        ) : !chosen ? (
          <EmptyState compact={false} title="No revenue in this period">
            A sale shows up here once a customer pays for an order. Try a longer period, or check Orders for payments that are still pending.
          </EmptyState>
        ) : (
          <div className={cn('space-y-5', summary.loading && 'opacity-60 transition-opacity')}>
            {summary.error && <p role="alert" className="text-sm text-red-700">Could not refresh. {summary.error} <button onClick={summary.reload} className="font-medium underline">Try again</button></p>}
            {summary.data!.currencies.length > 1 && (
              <Tabs label="Currency" idPrefix="currency" active={chosen.currency} onChange={pickCurrency}
                tabs={summary.data!.currencies.map((c) => ({ key: c.currency, label: c.currency }))} />
            )}

            <StatStrip label={`Revenue summary in ${chosen.currency}`} stats={statsFor(chosen)} />
            <p className="text-xs text-gray-500">
              You keep = gross sales - refunded - platform fee. Gross sales include orders that were refunded later; the refund is shown separately. Currencies are never added together.
            </p>

            <section aria-labelledby="rev-trend" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <h2 id="rev-trend" className="mb-3 text-base font-semibold text-gray-900">Day by day</h2>
              <RevenueChart series={chosen.series} currency={chosen.currency} />
            </section>

            <section aria-labelledby="rev-products" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <h2 id="rev-products" className="text-base font-semibold text-gray-900">Sales by product</h2>
              <p className="mt-0.5 text-sm text-gray-500">Before refunds, for orders paid in this period.</p>
              {chosen.products.top.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No products were sold in this period.</p>
              ) : (
                <ul className="mt-2 divide-y divide-gray-100">
                  {chosen.products.top.map((p) => (
                    <li key={p.productName} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 py-2 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
                      <span className="truncate text-sm text-gray-700" title={p.productName}>{p.productName}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                        <span className="block h-full rounded-full bg-teal-600" style={{ width: `${topSales > 0 ? Math.max(2, Math.round((p.sales / topSales) * 100)) : 0}%` }} />
                      </span>
                      <span className="whitespace-nowrap text-right text-sm font-medium tabular-nums text-gray-900">
                        {formatMoney(p.sales, chosen.currency)}
                        <span className="block text-xs font-normal text-gray-500">{p.quantity.toLocaleString()} sold</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {chosen.products.otherProducts > 0 && <p className="mt-2 text-xs text-gray-500">And {chosen.products.otherProducts} more {chosen.products.otherProducts === 1 ? 'product' : 'products'} with smaller sales.</p>}
            </section>

            <section aria-labelledby="rev-tx" className="rounded-xl border border-gray-200 bg-white">
              <h2 id="rev-tx" className="px-4 pt-4 pb-2 text-base font-semibold text-gray-900 sm:px-5">Transactions</h2>
              {ledger.loading && !ledger.data ? (
                <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              ) : ledger.error && !ledger.data ? (
                <div role="alert" className="m-4 flex flex-col items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-4">
                  <p className="text-sm text-gray-700">The transactions could not be loaded. {ledger.error}</p>
                  <Button size="sm" onClick={ledger.reload}>Try again</Button>
                </div>
              ) : !ledger.data || ledger.data.entries.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-gray-500">No transactions in this period.</p>
              ) : (
                <>
                  <TransactionsTable rows={ledger.data.entries} busy={ledger.loading} />
                  <Pagination page={page} pageSize={PAGE_SIZE} total={ledger.data.total} onChange={setPage} noun="transactions" />
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
