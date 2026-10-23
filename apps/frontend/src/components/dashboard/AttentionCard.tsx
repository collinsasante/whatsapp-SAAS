'use client';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatWaiting } from '@/lib/analytics/format';
import StatusBadge from '@/components/ui/StatusBadge';
import type { AttentionItem, DashboardAttention } from '@/lib/dashboard/types';

const SEVERITY = {
  critical: { label: 'Urgent', Icon: AlertOctagon, tone: 'text-rose-700', badge: 'danger', ring: 'border-rose-200 bg-rose-50/50' },
  warning: { label: 'Needs action', Icon: AlertTriangle, tone: 'text-amber-700', badge: 'warning', ring: 'border-amber-200 bg-amber-50/50' },
  info: { label: 'For your attention', Icon: Info, tone: 'text-gray-600', badge: 'neutral', ring: 'border-gray-200 bg-gray-50/60' },
} as const;

function Item({ item }: { item: AttentionItem }) {
  const sev = SEVERITY[item.severity];
  return (
    <li className={cn('rounded-lg border p-3', sev.ring)}>
      <div className="flex items-start gap-2.5">
        <sev.Icon size={16} className={cn('mt-0.5 shrink-0', sev.tone)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            <StatusBadge tone={sev.badge} className="mr-1.5">{sev.label}</StatusBadge>
            {item.title}
          </p>
          <p className="text-sm text-gray-600 mt-0.5">{item.detail}</p>
          {item.samples.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {item.samples.slice(0, 3).map((s) => (
                <li key={s.conversationId}>
                  <Link href={`/inbox?c=${s.conversationId}`} className="text-teal-700 hover:underline">
                    {s.contactName ?? 'Unnamed contact'}
                  </Link>
                  <span className="text-gray-500"> ({formatWaiting(s.ageSeconds)})</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={item.href} className="inline-flex items-center gap-0.5 mt-2 text-sm font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">
            Open the list<ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </li>
  );
}

export default function AttentionCard({ data }: { data: DashboardAttention }) {
  if (data.items.length === 0) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-teal-200 bg-teal-50/50 p-3">
        <CheckCircle2 size={18} className="text-teal-700 mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-gray-900">Nothing needs your attention right now</p>
          <p className="text-sm text-gray-600 mt-0.5">
            We checked {data.checked.length} {data.checked.length === 1 ? 'thing' : 'things'}: requests, owners, waiting customers, failed messages, campaigns and channel connections.
          </p>
          {data.notChecked.map((n) => <p key={n.kind} className="text-xs text-gray-500 mt-1">Not checked: {n.reason}</p>)}
        </div>
      </div>
    );
  }
  return (
    <>
      <ul className="space-y-2.5">{data.items.map((item) => <Item key={item.kind} item={item} />)}</ul>
      {data.notChecked.map((n) => <p key={n.kind} className="text-xs text-gray-500 mt-2">Not checked: {n.reason}</p>)}
    </>
  );
}
