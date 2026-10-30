'use client';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Clock3, MessageSquare, UserPlus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compare, formatDuration, formatMoney, formatNumber } from '@/lib/analytics/format';
import { DASHBOARD_METRICS } from '@/lib/dashboard/metrics';
import { analyticsHref, pointsDelta, periodWord } from '@/lib/dashboard/format';
import type { DashboardRange, DashboardSummary, PeriodSummary } from '@/lib/dashboard/types';
import type { MetricDefinition } from '@/lib/analytics/metrics';
import type { Delta } from '@/lib/analytics/format';
import { InfoTip } from '@/components/analytics/ui';

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

/** "up 150%" -> "150%", "down 5 points" -> "5 points". The arrow carries the direction. */
function amount(label: string): string {
  return label.replace(/^(up|down) /, '');
}

function Change({ delta, range }: { delta: Delta | null; range: DashboardRange }) {
  if (!delta || delta.verdict === 'unknown') {
    return <p className="mt-1 text-xs text-gray-500">{delta?.label ?? 'No comparison'}</p>;
  }
  const moved = delta.ratio != null && delta.ratio !== 0;
  const Icon = !moved ? null : delta.ratio! > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = delta.verdict === 'better' ? 'text-teal-700' : delta.verdict === 'worse' ? 'text-red-700' : 'text-gray-600';
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
      <span className={cn('inline-flex items-center gap-0.5 font-semibold', tone)}>
        {Icon ? <Icon size={13} aria-hidden="true" /> : <span aria-hidden="true">&mdash;</span>}
        {moved ? amount(delta.label) : delta.label}
      </span>
      <span className="text-gray-500">vs {periodWord(range).replace(/^the /, '')}</span>
      {delta.verdict !== 'same' && <span className="sr-only">, {delta.verdict}</span>}
    </p>
  );
}

/** The four headline numbers. */
export default function KpiCards({ data, range }: { data: DashboardSummary; range: DashboardRange }) {
  const byKey = new Map(buildCards(data, range).map((c) => [c.key, c]));
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4" aria-label="Key numbers">
      {TOP.map(({ key, Icon, tint }) => {
        const card = byKey.get(key);
        if (!card) return null;
        return (
          <li key={key} className="flex min-w-0 gap-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
            <span aria-hidden="true" className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12', tint)}><Icon size={22} /></span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700"><span>{card.definition.label}</span><InfoTip definition={card.definition} /></p>
              <p className="mt-0.5 text-3xl font-semibold tabular-nums text-gray-900">{card.value}</p>
              <Change delta={card.delta} range={range} />
              <p className="mt-2 text-xs text-gray-500">{card.explanation}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
