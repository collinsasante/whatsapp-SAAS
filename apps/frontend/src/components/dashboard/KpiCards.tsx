'use client';
import Link from 'next/link';
import { CheckCircle2, Clock3, MessageSquare, UserPlus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compare, formatDuration, formatMoney, formatNumber } from '@/lib/analytics/format';
import { DASHBOARD_METRICS } from '@/lib/dashboard/metrics';
import { analyticsHref, pointsDelta, periodWord } from '@/lib/dashboard/format';
import type { DashboardRange, DashboardSummary, PeriodSummary } from '@/lib/dashboard/types';
import type { MetricDefinition } from '@/lib/analytics/metrics';
import type { Delta } from '@/lib/analytics/format';
import { DeltaView, InfoTip } from '@/components/analytics/ui';

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

const TOP: Array<{ key: string; Icon: LucideIcon; tint: string }> = [
  { key: 'conversations', Icon: MessageSquare, tint: 'bg-teal-50 text-teal-700' },
  { key: 'newCustomers', Icon: UserPlus, tint: 'bg-blue-50 text-blue-600' },
  { key: 'firstReply', Icon: Clock3, tint: 'bg-purple-50 text-purple-600' },
  { key: 'resolution', Icon: CheckCircle2, tint: 'bg-teal-50 text-teal-700' },
];

/** The four headline numbers. Messages and the revenue or leads figure follow as one quiet line so nothing the dashboard showed before is lost. */
export default function KpiCards({ data, range }: { data: DashboardSummary; range: DashboardRange }) {
  const cards = buildCards(data, range);
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const messages = byKey.get('messages');
  const outcome = byKey.get('outcomes');
  return (
    <section aria-label="Key numbers">
      <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {TOP.map(({ key, Icon, tint }) => {
          const card = byKey.get(key);
          if (!card) return null;
          return (
            <li key={key} className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-gray-600">
                <span aria-hidden="true" className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg', tint)}><Icon size={15} /></span>
                <span>{card.definition.label}</span>
                <InfoTip definition={card.definition} />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900 sm:text-3xl">{card.value}</p>
              <div className="mt-0.5 min-h-[1.25rem]">
                {card.delta && card.delta.verdict !== 'unknown'
                  ? <span className="inline-flex items-center gap-1.5"><DeltaView delta={card.delta} /><span className="text-xs text-gray-500">vs {periodWord(range)}</span></span>
                  : <span className="text-xs text-gray-500">{card.delta?.label ?? 'No comparison'}</span>}
              </div>
              <p className="mt-1.5 text-xs text-gray-600 sm:text-sm">{card.explanation}</p>
            </li>
          );
        })}
      </ul>
      {(messages || outcome) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-600">
          {messages && <span>{messages.explanation.replace('Received from customers. ', `${messages.value} received from customers. `)} <Link href={messages.href} className="font-medium text-teal-700 hover:underline">Open the inbox</Link></span>}
          {outcome && <span>{outcome.definition.label}: <span className="font-medium text-gray-900 tabular-nums">{outcome.value}</span>. {outcome.explanation} <Link href={outcome.href} className="font-medium text-teal-700 hover:underline">{outcome.linkLabel}</Link></span>}
        </p>
      )}
    </section>
  );
}
