'use client';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Clock } from 'lucide-react';
import { formatNumber, formatWaiting } from '@/lib/analytics/format';
import { buttonClasses } from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import type { DashboardRequests } from '@/lib/dashboard/types';

/** Customers who asked for a person and are still waiting, against the workspace's reply deadline. */
export default function RequestsCard({ data }: { data: DashboardRequests }) {
  const { requesting, overdue, oldestWaitingSeconds, deadlineMinutes, samples } = data;
  return (
    <div>
      {requesting === 0 ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-teal-200 bg-teal-50 p-3">
          <CheckCircle2 size={18} className="text-teal-700 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-gray-900">Nobody is waiting for a person</p>
            <p className="text-sm text-gray-600 mt-0.5">New requests appear here as soon as a customer asks for one.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <p className="text-4xl font-semibold text-gray-900 tabular-nums">{formatNumber(requesting)}</p>
            <p className="text-sm text-gray-600 pb-1.5">{requesting === 1 ? 'customer is' : 'customers are'} waiting for a person</p>
            {overdue > 0 && <StatusBadge tone="danger" className="mb-1.5">{formatNumber(overdue)} past the deadline</StatusBadge>}
          </div>
          {oldestWaitingSeconds != null && (
            <p className="text-sm text-gray-600 mt-1">The longest wait is {formatWaiting(oldestWaitingSeconds)}.</p>
          )}
          {samples.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100">
              {samples.map((s) => (
                <li key={s.conversationId} className="py-1.5 flex items-center justify-between gap-3 text-sm">
                  <Link href={`/inbox?c=${s.conversationId}`} className="text-teal-700 hover:underline truncate">
                    {s.contactName ?? 'Unnamed contact'}
                  </Link>
                  <span className={s.overdue ? 'text-red-700 font-medium whitespace-nowrap' : 'text-gray-500 whitespace-nowrap'}>
                    {formatWaiting(s.waitingSeconds)}{s.overdue ? ', overdue' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/inbox?status=REQUESTED" className={buttonClasses('primary', 'sm', 'mt-3')}>
            Open requests<ChevronRight size={14} aria-hidden="true" />
          </Link>
        </>
      )}

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-4 pt-3 border-t border-gray-100 text-sm text-gray-600">
        <Clock size={14} aria-hidden="true" className="text-gray-400" />
        {deadlineMinutes == null
          ? <span>No reply deadline is set.</span>
          : <span>Reply deadline: <span className="font-medium text-gray-900">{deadlineMinutes} {deadlineMinutes === 1 ? 'minute' : 'minutes'}</span>.</span>}
        <Link href="/manage?tab=replydeadline" className="font-medium text-teal-700 hover:underline">
          {deadlineMinutes == null ? 'Set a deadline' : 'Change'}
        </Link>
      </p>
    </div>
  );
}
