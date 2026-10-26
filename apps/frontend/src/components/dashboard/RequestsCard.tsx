'use client';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Clock } from 'lucide-react';
import { formatNumber, formatWaiting } from '@/lib/analytics/format';
import { buttonClasses } from '@/components/ui/Button';
import type { DashboardRequests } from '@/lib/dashboard/types';

/** How the waiting customers divide between inside the reply deadline and past it. Counts are always written out, never colour alone. */
function WaitingSplit({ requesting, overdue, hasDeadline }: { requesting: number; overdue: number; hasDeadline: boolean }) {
  const within = Math.max(requesting - overdue, 0);
  const label = hasDeadline
    ? `${within} within the reply deadline, ${overdue} past it`
    : `${requesting} waiting, no reply deadline set`;
  return (
    <div className="mt-4">
      <div role="img" aria-label={label} className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        {within > 0 && <div className="h-full bg-teal-600" style={{ width: `${(within / requesting) * 100}%` }} />}
        {overdue > 0 && <div className="h-full bg-red-500" style={{ width: `${(overdue / requesting) * 100}%` }} />}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-teal-600" />
          <dt className="text-gray-600">{hasDeadline ? 'Within the deadline' : 'Waiting'}</dt>
          <dd className="font-medium text-gray-900 tabular-nums">{formatNumber(within)}</dd>
        </div>
        {hasDeadline && (
          <div className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-500" />
            <dt className="text-gray-600">Past the deadline</dt>
            <dd className="font-medium text-gray-900 tabular-nums">{formatNumber(overdue)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** The longest wait against the reply deadline: the track is the deadline, the fill is how much of it the longest wait has used. */
function LongestWait({ seconds, deadlineMinutes }: { seconds: number; deadlineMinutes: number | null }) {
  if (deadlineMinutes == null) {
    return <p className="text-sm text-gray-600 mt-3">The longest wait is <span className="font-medium text-gray-900">{formatWaiting(seconds)}</span>.</p>;
  }
  const used = seconds / (deadlineMinutes * 60);
  const tone = used > 1 ? 'bg-red-500' : used > 0.75 ? 'bg-amber-500' : 'bg-teal-600';
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-gray-600">Longest wait <span className="font-medium text-gray-900">{formatWaiting(seconds)}</span></span>
        <span className="text-xs text-gray-500">Deadline {deadlineMinutes} min</span>
      </div>
      <div
        role="meter" aria-label="Longest wait compared with the reply deadline"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(Math.round(used * 100), 100)}
        aria-valuetext={used > 1 ? 'Past the deadline' : `${Math.round(used * 100)}% of the deadline used`}
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(used, 1) * 100}%` }} />
      </div>
    </div>
  );
}

/** Customers who asked for a person and are still waiting, against the workspace's reply deadline. */
export default function RequestsCard({ data }: { data: DashboardRequests }) {
  const { requesting, overdue, oldestWaitingSeconds, deadlineMinutes } = data;
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
          </div>
          <WaitingSplit requesting={requesting} overdue={overdue} hasDeadline={deadlineMinutes != null} />
          {oldestWaitingSeconds != null && <LongestWait seconds={oldestWaitingSeconds} deadlineMinutes={deadlineMinutes} />}
          <Link href="/inbox?status=REQUESTED" className={buttonClasses('primary', 'sm', 'mt-4')}>
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
