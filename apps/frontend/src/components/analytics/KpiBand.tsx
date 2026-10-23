'use client';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration, formatMoney, formatNumber } from '@/lib/analytics/format';
import { METRICS, type MetricKey } from '@/lib/analytics/metrics';
import type { IntelligenceResponse } from '@/lib/analytics/types';
import { DeltaBadge, InfoTip, Panel } from './ui';

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const max = Math.max(...values);
  const w = 88, h = 24;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  return (
    <svg aria-hidden="true" width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-teal-600 flex-shrink-0">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface TileProps {
  metric: MetricKey;
  /** Overrides the metric's default label, for example when the channel changes the meaning. */
  label?: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  spark?: number[];
  href?: string;
  hrefLabel?: string;
  unavailable?: boolean;
}

function Tile({ metric, label, value, detail, spark, href, hrefLabel, unavailable }: TileProps) {
  const def = METRICS[metric];
  return (
    <div className="bg-white p-4 min-w-0 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <span className="truncate">{label ?? def.label}</span>
        <InfoTip definition={def} />
        {href && (
          <Link href={href} aria-label={hrefLabel ?? `Open ${def.label}`} className="ml-auto text-gray-400 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className={cn('tabular-nums tracking-tight font-semibold', unavailable ? 'text-base text-gray-400' : 'text-2xl text-gray-900')}>
          {value}
        </p>
        {spark && <Sparkline values={spark} />}
      </div>
      <div className="text-xs text-gray-500 min-h-[1rem]">{detail}</div>
    </div>
  );
}

export default function KpiBand({ data }: { data: IntelligenceResponse }) {
  const { current: c, previous: p, coverage, series, backlog } = data;
  const channelNote = data.meta.channel === 'ALL' ? '' : ' on this channel';
  const money = c.orders.byCurrency;

  return (
    <Panel className="overflow-hidden">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200">
        <Tile
          metric="conversations" value={formatNumber(c.conversations.total)} spark={series.map((s) => s.opened)}
          href="/inbox" hrefLabel="Open the inbox"
          detail={<DeltaBadge current={c.conversations.total} previous={p.conversations.total} direction="neutral" />}
        />
        <Tile
          metric="newContacts" value={formatNumber(c.newContacts)} spark={series.map((s) => s.newContacts)}
          href="/contacts" hrefLabel="Open contacts"
          detail={<DeltaBadge current={c.newContacts} previous={p.newContacts} direction="higher-is-better" />}
        />
        <Tile
          metric="firstReply"
          value={c.firstResponse.samples > 0 ? formatDuration(c.firstResponse.medianSeconds) : 'No replies yet'}
          unavailable={c.firstResponse.samples === 0}
          detail={c.firstResponse.samples > 0 ? (
            <span className="flex flex-wrap items-center gap-x-2">
              <DeltaBadge current={c.firstResponse.medianSeconds} previous={p.firstResponse.medianSeconds} direction="lower-is-better" />
              <span>9 in 10 within {formatDuration(c.firstResponse.p90Seconds)}</span>
            </span>
          ) : `No conversation opened in this period${channelNote} has been answered.`}
        />
        <Tile
          metric="resolved" value={formatNumber(c.resolved)} spark={series.map((s) => s.resolved)}
          detail={<DeltaBadge current={c.resolved} previous={p.resolved} direction="higher-is-better" />}
        />
        <Tile
          metric="openNow" value={formatNumber(backlog.open)} href="/inbox" hrefLabel="Open the inbox"
          detail={backlog.open === 0 ? 'Nothing waiting' : `${backlog.unassigned} without an owner, ${backlog.awaitingReply} waiting on you`}
        />
        {coverage.csat ? (
          <Tile
            metric="csat"
            value={c.csat.average != null ? `${c.csat.average} / 5` : 'No ratings'}
            unavailable={c.csat.average == null}
            detail={c.csat.average != null ? (
              <span className="flex flex-wrap items-center gap-x-2">
                <DeltaBadge current={c.csat.average} previous={p.csat.average} direction="higher-is-better" />
                <span>{c.csat.responses} {c.csat.responses === 1 ? 'rating' : 'ratings'}</span>
              </span>
            ) : 'No ratings were submitted in this period.'}
          />
        ) : (
          <Tile metric="csat" value="Not tracked" unavailable detail="No customer has rated a conversation yet." />
        )}
        {coverage.leads ? (
          <Tile
            metric="leads" value={formatNumber(c.leads.created)} href="/contacts" hrefLabel="Open contacts"
            detail={
              <span className="flex flex-wrap items-center gap-x-2">
                <DeltaBadge current={c.leads.created} previous={p.leads.created} direction="higher-is-better" />
                <span>{c.leads.qualified} qualified</span>
              </span>
            }
          />
        ) : (
          <Tile metric="leads" value="Not tracked" unavailable detail="Leads appear once Verz AI has scored a conversation." />
        )}
        {coverage.orders ? (
          <Tile
            metric="revenue"
            value={money.length === 0 ? 'No paid orders' : money.length === 1 ? formatMoney(money[0].revenue, money[0].currency) : `${money.length} currencies`}
            unavailable={money.length === 0}
            href="/commerce" hrefLabel="Open Commerce"
            detail={money.length === 0 ? `No order${channelNote} was paid in this period.` : money.length === 1 ? (
              <span className="flex flex-wrap items-center gap-x-2">
                <DeltaBadge current={money[0].revenue} previous={p.orders.byCurrency.find((o) => o.currency === money[0].currency)?.revenue ?? 0} direction="higher-is-better" />
                <span>{money[0].paidOrders} {money[0].paidOrders === 1 ? 'order' : 'orders'}</span>
              </span>
            ) : money.map((m) => formatMoney(m.revenue, m.currency)).join(', ')}
          />
        ) : (
          <Tile metric="revenue" value="Not tracked" unavailable href="/commerce" hrefLabel="Open Commerce" detail="No orders are recorded. Revenue comes from Commerce orders." />
        )}
      </div>
      <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-200 bg-gray-50/60 rounded-b-xl">
        Compared with the previous {data.meta.days} {data.meta.days === 1 ? 'day' : 'days'}.
        Hover or focus the info icon on any number to see how it is calculated.
      </p>
    </Panel>
  );
}
