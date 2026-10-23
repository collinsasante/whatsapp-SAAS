'use client';
import Link from 'next/link';
import { freshness } from '@/lib/dashboard/format';
import type { ActivityKind, DashboardActivity } from '@/lib/dashboard/types';
import { EmptyNote } from '@/components/analytics/ui';

type Entry = DashboardActivity['entries'][number];

function sentence(e: Entry): string {
  const customer = e.contactName ?? 'a customer';
  const lines: Record<ActivityKind, string> = {
    requested: `${customer} asked for a person`,
    intervened: `${e.actorName ?? 'A team member'} took over ${customer}'s conversation`,
    resolved: `${e.actorName ?? 'Someone'} resolved ${customer}'s conversation`,
    reopened: `${customer}'s conversation was reopened`,
    assigned: `${customer}'s conversation was assigned`,
    unassigned: `${customer}'s conversation was left without an owner`,
    transferred: `${customer}'s conversation was transferred`,
    sla_breached: `${customer} waited past the reply deadline`,
  };
  return lines[e.kind];
}

export default function ActivityCard({ data }: { data: DashboardActivity }) {
  if (data.entries.length === 0) {
    return <EmptyNote title="No recent activity">Requests, hand-offs and resolved conversations from the last 30 days appear here.</EmptyNote>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {data.entries.map((e) => (
        <li key={e.id} className="py-2">
          <Link href={`/inbox?c=${e.conversationId}`} className="block text-sm text-gray-800 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">
            {sentence(e)}
            <span className="block text-xs text-gray-500">{freshness(e.at).text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
