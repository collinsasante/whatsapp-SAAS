'use client';
import Link from 'next/link';
import { formatDuration, formatNumber } from '@/lib/analytics/format';
import type { DashboardTeam } from '@/lib/dashboard/types';
import { EmptyNote } from '@/components/analytics/ui';

/** Fewer answered conversations than this and a median says little; the card says so instead of implying precision. */
const MIN_SAMPLES = 5;

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 tabular-nums">{value}{note && <span className="block text-xs font-normal text-gray-500">{note}</span>}</dd>
    </div>
  );
}

export default function TeamCard({ data }: { data: DashboardTeam }) {
  const { agents, workload } = data;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-700 mb-3">
        <span><span className="font-semibold text-gray-900 tabular-nums">{formatNumber(workload.open)}</span> open now</span>
        <span>
          <span className="font-semibold text-gray-900 tabular-nums">{formatNumber(workload.unassigned)}</span> with no owner
          {workload.unassigned > 0 && (
            <> <Link href="/inbox?status=ACTIVE&assignee=unassigned" className="text-teal-700 font-medium hover:underline">Assign them</Link></>
          )}
        </span>
      </div>

      {agents.length === 0 ? (
        <EmptyNote title="No team activity in this period" href="/settings/team" hrefLabel="Manage your team">
          Conversations assigned to your team members will show here.
        </EmptyNote>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {agents.map((a) => (
              <li key={a.agentId} className="py-3">
                <p className="text-sm font-semibold text-gray-900 mb-1.5">{a.name}</p>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <Stat label="Assigned" value={formatNumber(a.assigned)} />
                  <Stat label="Open now" value={formatNumber(a.openNow)} />
                  <Stat label="Resolved" value={formatNumber(a.resolved)} />
                  <Stat
                    label="Median first reply"
                    value={a.firstResponse.samples === 0 ? 'n/a' : formatDuration(a.firstResponse.medianSeconds)}
                    note={a.firstResponse.samples === 0 ? 'No replies yet' : a.firstResponse.samples < MIN_SAMPLES ? `Only ${a.firstResponse.samples} ${a.firstResponse.samples === 1 ? 'reply' : 'replies'}` : undefined}
                  />
                </dl>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 mt-2">Listed alphabetically. These figures show workload, not a ranking of people.</p>
        </>
      )}
    </div>
  );
}
