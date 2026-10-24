'use client';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compare, formatDuration, formatMoney, formatNumber } from '@/lib/analytics/format';
import { DASHBOARD_METRICS } from '@/lib/dashboard/metrics';
import { analyticsHref, pointsDelta, periodWord } from '@/lib/dashboard/format';
import type { DashboardRange, DashboardRequests, DashboardSummary, PeriodSummary } from '@/lib/dashboard/types';
import type { MetricDefinition } from '@/lib/analytics/metrics';
import type { Delta } from '@/lib/analytics/format';
import { DeltaView, InfoTip } from '@/components/analytics/ui';
import { CardHeader } from '@/components/ui/Card';
import Skeleton from '@/components/ui/Skeleton';
import RequestsCard from '@/components/dashboard/RequestsCard';
import type { Widget } from '@/lib/dashboard/useWidget';

interface Card {
  key: string;
  definition: MetricDefinition;
  value: string;
  /** Plain-words reading of the number, shown under it. */
  explanation: string;
  delta: Delta | null;
  href: string;
  linkLabel: string;
}

function revenueLines(summary: PeriodSummary) {
  return summary.orders.byCurrency.filter((o) => o.paidOrders > 0);
}

export function buildCards(data: DashboardSummary, range: DashboardRange): Card[] {
  const { current: c, previous: p, coverage } = data;
  const cards: Card[] = [
    {
      key: 'conversations', definition: DASHBOARD_METRICS.conversations,
      value: formatNumber(c.conversations.total),
      explanation: c.conversations.total === 0
        ? 'No conversations started in this period.'
        : `${c.conversations.newContact} from new customers, ${c.conversations.returningContact} from returning customers.`,
      delta: compare(c.conversations.total, p.conversations.total, 'neutral'),
      href: analyticsHref(range, 'conversations'), linkLabel: 'See conversation details',
    },
    {
      key: 'newCustomers', definition: DASHBOARD_METRICS.newCustomers,
      value: formatNumber(c.newCustomers),
      explanation: c.newCustomers === 0 ? 'Nobody new reached you in this period.' : 'People who contacted you for the first time.',
      delta: compare(c.newCustomers, p.newCustomers, 'higher-is-better'),
      href: '/contacts', linkLabel: 'Open contacts',
    },
    {
      key: 'firstReply', definition: DASHBOARD_METRICS.firstReply,
      value: formatDuration(c.firstResponse.medianSeconds),
      explanation: c.firstResponse.medianSeconds == null
        ? 'No conversation in this period has been answered yet.'
        : `Typical wait for a first answer, from ${formatNumber(c.firstResponse.samples)} answered ${c.firstResponse.samples === 1 ? 'conversation' : 'conversations'}.`,
      delta: compare(c.firstResponse.medianSeconds, p.firstResponse.medianSeconds, 'lower-is-better'),
      href: analyticsHref(range, 'conversations'), linkLabel: 'See reply times',
    },
    {
      key: 'resolution', definition: DASHBOARD_METRICS.resolutionRate,
      value: c.resolution.rate == null ? 'n/a' : `${c.resolution.rate}%`,
      explanation: c.resolution.rate == null
        ? 'No conversations were opened in this period.'
        : `${formatNumber(c.resolution.resolved)} of ${formatNumber(c.resolution.opened)} conversations opened are resolved.`,
      delta: pointsDelta(c.resolution.rate, p.resolution.rate),
      href: '/inbox?status=ACTIVE', linkLabel: 'Open the inbox',
    },
    {
      key: 'messages', definition: DASHBOARD_METRICS.messages,
      value: formatNumber(c.engagement.inbound),
      explanation: `Received from customers. You sent ${formatNumber(c.engagement.outbound)} in reply.`,
      delta: compare(c.engagement.inbound, p.engagement.inbound, 'neutral'),
      href: '/inbox', linkLabel: 'Open the inbox',
    },
  ];

  // Only show outcomes the workspace really records. A workspace that never used orders or leads gets no card,
  // rather than a "0" that reads as "no sales".
  const lines = revenueLines(c);
  if (coverage.orders && lines.length > 0) {
    const top = lines[0];
    const prev = p.orders.byCurrency.find((o) => o.currency === top.currency)?.revenue ?? 0;
    cards.push({
      key: 'outcomes', definition: DASHBOARD_METRICS.outcomes,
      value: formatMoney(top.revenue, top.currency),
      explanation: lines.length > 1
        ? `${top.paidOrders} paid ${top.paidOrders === 1 ? 'order' : 'orders'} in ${top.currency}. Other currencies: ${lines.slice(1).map((l) => formatMoney(l.revenue, l.currency)).join(', ')}.`
        : `From ${top.paidOrders} paid ${top.paidOrders === 1 ? 'order' : 'orders'}.`,
      delta: compare(top.revenue, prev, 'higher-is-better'),
      href: '/commerce/revenue', linkLabel: 'See revenue',
    });
  } else if (coverage.leads && c.leads.created > 0) {
    cards.push({
      key: 'outcomes', definition: DASHBOARD_METRICS.outcomes,
      value: formatNumber(c.leads.qualified),
      explanation: `Qualified leads, out of ${formatNumber(c.leads.created)} created. Scored automatically from the conversation.`,
      delta: compare(c.leads.qualified, p.leads.qualified, 'higher-is-better'),
      href: analyticsHref(range, 'customers'), linkLabel: 'See leads',
    });
  }
  return cards;
}

export default function KpiCards({ data, range, requests }: {
  data: DashboardSummary;
  range: DashboardRange;
  requests: Widget<DashboardRequests>;
}) {
  const cards = buildCards(data, range);
  const finalCard = cards[cards.length - 1];
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 bg-white border border-gray-200 rounded-xl p-4 sm:p-5 scroll-mt-24" aria-label="Key numbers">
      {cards.slice(0, -1).map((card) => (
        <li key={card.key} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 flex flex-col">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
            <span>{card.definition.label}</span>
            <InfoTip definition={card.definition} />
          </div>
          <p className="text-3xl font-semibold text-gray-900 tabular-nums mt-1.5">{card.value}</p>
          <div className="mt-1 min-h-[1.25rem]">
            {card.delta && card.delta.verdict !== 'unknown'
              ? <span className="inline-flex items-center gap-1.5"><DeltaView delta={card.delta} /><span className="text-xs text-gray-500">vs {periodWord(range)}</span></span>
              : <span className="text-xs text-gray-500">{card.delta?.label ?? 'No comparison'}</span>}
          </div>
          <p className="text-sm text-gray-600 mt-2 flex-1">{card.explanation}</p>
          <Link
            href={card.href}
            className={cn('inline-flex items-center gap-0.5 mt-3 text-sm font-medium text-teal-700 hover:underline w-fit',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded')}
          >
            {card.linkLabel}<ChevronRight size={14} aria-hidden="true" />
          </Link>
        </li>
      ))}
      {finalCard && (
        <li className="sm:col-span-2 xl:col-span-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 flex flex-col sm:col-span-2 xl:col-span-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
                <span>{finalCard.definition.label}</span>
                <InfoTip definition={finalCard.definition} />
              </div>
              <p className="text-3xl font-semibold text-gray-900 tabular-nums mt-1.5">{finalCard.value}</p>
              <div className="mt-1 min-h-[1.25rem]">
                {finalCard.delta && finalCard.delta.verdict !== 'unknown'
                  ? <span className="inline-flex items-center gap-1.5"><DeltaView delta={finalCard.delta} /><span className="text-xs text-gray-500">vs {periodWord(range)}</span></span>
                  : <span className="text-xs text-gray-500">{finalCard.delta?.label ?? 'No comparison'}</span>}
              </div>
              <p className="text-sm text-gray-600 mt-2 flex-1">{finalCard.explanation}</p>
              <Link
                href={finalCard.href}
                className={cn('inline-flex items-center gap-0.5 mt-3 text-sm font-medium text-teal-700 hover:underline w-fit',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded')}
              >
                {finalCard.linkLabel}<ChevronRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <section id="requests" aria-labelledby="requests-heading" className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 flex flex-col">
              <CardHeader id="requests-heading" title="Requesting" description="Customers waiting for a person" />
              {requests.data ? (
                <div className={cn('flex-1', requests.loading && 'opacity-60')}>
                  <RequestsCard data={requests.data} />
                  {requests.error && (
                    <p role="alert" className="mt-3 text-sm text-red-700">
                      Could not refresh this section. {requests.error}{' '}
                      <button onClick={requests.reload} className="font-medium underline hover:no-underline">Try again</button>
                    </p>
                  )}
                </div>
              ) : requests.error ? (
                <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-red-50 border border-red-100 p-4">
                  <p className="text-sm text-gray-600">{requests.error}</p>
                  <button onClick={requests.reload} className="text-sm font-medium underline hover:no-underline">Try again</button>
                </div>
              ) : (
                <Skeleton className="h-40" />
              )}
            </section>
          </div>
        </li>
      )}
    </ul>
  );
}
