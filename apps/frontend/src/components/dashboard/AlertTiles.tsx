'use client';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AttentionItem, AttentionKind, DashboardAttention } from '@/lib/dashboard/types';

type Severity = AttentionItem['severity'];

/** The four things an owner should always be able to see at a glance. Other kinds are listed below them when present. */
const TILES: Array<{ kind: AttentionKind; label: string; explain: string | null; calm: string; action: string; href: string }> = [
  { kind: 'sla_breached', label: 'Past deadline', explain: 'Customers who asked for a person, past the reply deadline.', calm: 'No request is past your reply deadline.', action: 'Open requests', href: '/inbox?status=REQUESTED' },
  { kind: 'awaiting_reply', label: 'Awaiting reply', explain: null, calm: 'Every customer has had an answer.', action: 'Open waiting chats', href: '/inbox?status=UNREPLIED' },
  { kind: 'unassigned', label: 'No owner', explain: 'Open conversations nobody is responsible for.', calm: 'Every open conversation has an owner.', action: 'Assign conversations', href: '/inbox?status=ACTIVE&assignee=unassigned' },
  { kind: 'failed_deliveries', label: 'Failed to send', explain: 'Replies that did not reach the customer.', calm: 'No message failed to send.', action: 'Review messages', href: '/inbox' },
];

const STYLE: Record<Severity | 'none', { box: string; count: string; Icon: typeof Info; word: string }> = {
  critical: { box: 'border-red-200 bg-red-50', count: 'text-red-700', Icon: AlertOctagon, word: 'Urgent' },
  warning: { box: 'border-amber-200 bg-amber-50', count: 'text-amber-700', Icon: AlertTriangle, word: 'Needs action' },
  info: { box: 'border-gray-200 bg-white', count: 'text-gray-900', Icon: Info, word: 'For your attention' },
  none: { box: 'border-gray-200 bg-white', count: 'text-gray-900', Icon: CheckCircle2, word: 'All clear' },
};

function Tile({ tile, item, notChecked }: { tile: (typeof TILES)[number]; item: AttentionItem | undefined; notChecked: string | undefined }) {
  const sev = STYLE[item ? item.severity : 'none'];
  const href = item?.href ?? tile.href;
  return (
    <li className={cn('flex flex-col rounded-xl border p-4', notChecked ? 'border-gray-200 bg-white' : sev.box)}>
      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        <sev.Icon size={15} aria-hidden="true" className={cn('shrink-0', item ? sev.count : 'text-teal-700')} />
        <span>{tile.label}</span>
      </div>
      {notChecked ? (
        <>
          <p className="mt-2 text-sm text-gray-600 flex-1">{notChecked}</p>
          <Link href="/manage?tab=replydeadline" className="mt-3 inline-flex items-center gap-0.5 text-sm font-medium text-teal-700 hover:underline w-fit">Set a reply deadline<ChevronRight size={14} aria-hidden="true" /></Link>
        </>
      ) : (
        <>
          <p className="mt-1.5 flex items-baseline gap-2">
            <span className={cn('text-3xl font-semibold tabular-nums', sev.count)}>{(item?.count ?? 0).toLocaleString()}</span>
            <span className="text-xs font-medium text-gray-600">{sev.word}</span>
          </p>
          <p className="mt-1 flex-1 text-sm text-gray-600">{item ? tile.explain ?? item.detail : tile.calm}</p>
          <Link
            href={href}
            className={cn('mt-3 inline-flex items-center gap-0.5 text-sm font-medium hover:underline w-fit rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600', item ? 'text-teal-700' : 'text-gray-500')}
          >
            {tile.action}<ChevronRight size={14} aria-hidden="true" />
          </Link>
        </>
      )}
    </li>
  );
}

export default function AlertTiles({ data }: { data: DashboardAttention }) {
  const byKind = new Map(data.items.map((i) => [i.kind, i]));
  const reasons = new Map(data.notChecked.map((n) => [n.kind, n.reason]));
  const shown = new Set(TILES.map((t) => t.kind));
  const also = data.items.filter((i) => !shown.has(i.kind));
  return (
    <div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Alerts">
        {TILES.map((t) => <Tile key={t.kind} tile={t} item={byKind.get(t.kind)} notChecked={reasons.get(t.kind)} />)}
      </ul>
      {also.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Other things that need attention">
          {also.map((i) => {
            const sev = STYLE[i.severity];
            return (
              <li key={i.kind} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm', sev.box)}>
                <span className="flex min-w-0 items-center gap-2 text-gray-800"><sev.Icon size={15} aria-hidden="true" className={cn('shrink-0', sev.count)} /><span><span className="font-medium">{i.title}.</span> {i.detail}</span></span>
                <Link href={i.href} className="inline-flex items-center gap-0.5 font-medium text-teal-700 hover:underline">Open<ChevronRight size={14} aria-hidden="true" /></Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
