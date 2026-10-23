'use client';
import Link from 'next/link';
import type { DashboardRecommendations } from '@/lib/dashboard/types';
import { EmptyNote } from '@/components/analytics/ui';

const SEVERITY: Record<string, string> = { attention: 'Needs attention', opportunity: 'Opportunity', info: 'Good to know' };

export default function RecommendationsCard({ data }: { data: DashboardRecommendations }) {
  if (data.insights.length === 0) {
    return <EmptyNote title="No recommendations yet">We suggest actions only when the numbers support them. Check back once there is more activity.</EmptyNote>;
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {data.insights.map((i) => (
        <li key={i.id} className="rounded-lg border border-gray-200 p-3.5">
          <p className="text-xs font-semibold text-gray-500">{SEVERITY[i.severity] ?? 'Insight'}</p>
          <p className="text-sm font-medium text-gray-900 mt-0.5">{i.title}</p>
          <p className="text-sm text-gray-600 mt-1">{i.why}</p>
          <ul className="mt-1.5 list-disc pl-4 text-xs text-gray-500 space-y-0.5">
            {i.evidence.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="text-sm text-gray-800 mt-2"><span className="font-medium">Next step:</span> {i.action}</p>
          {i.link && <Link href={i.link.href} className="inline-block mt-1.5 text-sm font-medium text-teal-700 hover:underline">{i.link.label}</Link>}
        </li>
      ))}
    </ul>
  );
}
