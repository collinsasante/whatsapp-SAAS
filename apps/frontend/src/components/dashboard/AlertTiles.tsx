'use client';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, Clock3, Info, MessageSquare, Send, UserRound, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AttentionItem, AttentionKind, DashboardAttention } from '@/lib/dashboard/types';

interface Accent { box: string; chipBg: string; chip: string; count: string; link: string }

const RED: Accent = { box: 'border-red-200 bg-white', chipBg: 'bg-red-50', chip: 'text-red-600', count: 'text-red-600', link: 'text-red-700' };
const ORANGE: Accent = { box: 'border-orange-200 bg-white', chipBg: 'bg-orange-50', chip: 'text-orange-600', count: 'text-orange-600', link: 'text-orange-700' };
const AMBER: Accent = { box: 'border-amber-200 bg-white', chipBg: 'bg-amber-50', chip: 'text-amber-600', count: 'text-amber-600', link: 'text-amber-700' };
const CALM: Accent = { box: 'border-gray-200 bg-white', chipBg: 'bg-gray-50', chip: 'text-gray-400', count: 'text-gray-900', link: 'text-gray-500' };

/** The four things an owner should always be able to see at a glance. Other kinds are listed below them when present. */
const TILES: Array<{ kind: AttentionKind; Icon: LucideIcon; accent: Accent; label: string; explain: string | null; calm: string; action: string; href: string }> = [
  { kind: 'sla_breached', Icon: Clock3, accent: RED, label: 'requests past reply deadline', explain: 'These customers asked for a person and the reply deadline for the workspace has passed.', calm: 'No request is past your reply deadline.', action: 'Open the list', href: '/inbox?status=REQUESTED' },
  { kind: 'awaiting_reply', Icon: MessageSquare, accent: ORANGE, label: 'customers waiting for a reply', explain: null, calm: 'Every customer has had an answer.', action: 'Open inbox', href: '/inbox?status=UNREPLIED' },
  { kind: 'unassigned', Icon: UserRound, accent: AMBER, label: 'conversations with no owner', explain: 'Nobody is assigned, so nobody is responsible for replying.', calm: 'Every open conversation has an owner.', action: 'Assign conversations', href: '/inbox?status=ACTIVE&assignee=unassigned' },
  { kind: 'failed_deliveries', Icon: Send, accent: RED, label: 'failed messages', explain: 'Replies that did not reach the customer. Check the errors and retry where appropriate.', calm: 'No message failed to send.', action: 'Review failures', href: '/inbox' },
];

function Tile({ tile, item, notChecked }: { tile: (typeof TILES)[number]; item: AttentionItem | undefined; notChecked: string | undefined }) {
  const count = item?.count ?? 0;
  const a = item && !notChecked ? tile.accent : CALM;
  const href = item?.href ?? tile.href;
  return (
    <li className={cn('flex min-w-0 flex-col rounded-xl border p-4', a.box)}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', a.chipBg, a.chip)}><tile.Icon size={18} /></span>
        {notChecked ? <span className="text-sm font-medium text-gray-700">{tile.label}</span> : <span className={cn('text-3xl font-semibold tabular-nums leading-none', a.count)}>{count.toLocaleString()}</span>}
      </div>
      {!notChecked && <p className={cn('mt-2 text-sm font-medium', item ? a.count : 'text-gray-700')}>{tile.label}</p>}
      <p className="mt-1.5 flex-1 text-xs text-gray-600">{notChecked ?? (item ? tile.explain ?? item.detail : tile.calm)}</p>
      <Link
        href={notChecked ? '/manage?tab=replydeadline' : href}
        className={cn('mt-3 inline-flex w-fit items-center gap-0.5 rounded text-xs font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600', a.link)}
      >
        {notChecked ? 'Set a reply deadline' : tile.action}<ChevronRight size={13} aria-hidden="true" />
      </Link>
      {item && !notChecked && <span className="sr-only">{item.severity === 'critical' ? 'Urgent' : 'Needs action'}</span>}
    </li>
  );
}

const OTHER_STYLE = {
  critical: { box: 'border-red-200 bg-red-50', Icon: AlertOctagon, tone: 'text-red-600' },
  warning: { box: 'border-amber-200 bg-amber-50', Icon: AlertTriangle, tone: 'text-amber-600' },
  info: { box: 'border-gray-200 bg-white', Icon: Info, tone: 'text-gray-500' },
} as const;

export default function AlertTiles({ data }: { data: DashboardAttention }) {
  const byKind = new Map(data.items.map((i) => [i.kind, i]));
  const reasons = new Map(data.notChecked.map((n) => [n.kind, n.reason]));
  const shown = new Set(TILES.map((t) => t.kind));
  const also = data.items.filter((i) => !shown.has(i.kind));
  const allClear = data.items.length === 0 && data.notChecked.length === 0;
  return (
    <div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Alerts">
        {TILES.map((t) => <Tile key={t.kind} tile={t} item={byKind.get(t.kind)} notChecked={reasons.get(t.kind)} />)}
      </ul>
      {allClear && <p className="mt-3 flex items-center gap-1.5 text-sm text-gray-600"><CheckCircle2 size={15} className="text-teal-700" aria-hidden="true" />Nothing needs your attention right now.</p>}
      {also.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Other things that need attention">
          {also.map((i) => {
            const sev = OTHER_STYLE[i.severity];
            return (
              <li key={i.kind} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm', sev.box)}>
                <span className="flex min-w-0 items-center gap-2 text-gray-800"><sev.Icon size={15} aria-hidden="true" className={cn('shrink-0', sev.tone)} /><span><span className="font-medium">{i.title}.</span> {i.detail}</span></span>
                <Link href={i.href} className="inline-flex items-center gap-0.5 font-medium text-teal-700 hover:underline">Open<ChevronRight size={14} aria-hidden="true" /></Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
