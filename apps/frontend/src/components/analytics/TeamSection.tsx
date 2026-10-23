'use client';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { formatDuration, formatNumber } from '@/lib/analytics/format';
import type { AgentRow, IntelligenceResponse } from '@/lib/analytics/types';
import { EmptyNote, Panel } from './ui';

type SortKey = 'name' | 'assigned' | 'resolved' | 'openNow' | 'reopened' | 'firstReply' | 'resolution' | 'csat';

const LOW_SAMPLE = 5;

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean; hint?: string }> = [
  { key: 'name', label: 'Agent', numeric: false },
  { key: 'assigned', label: 'Assigned', numeric: true, hint: 'Conversations opened in the period that are now assigned to this person' },
  { key: 'resolved', label: 'Resolved', numeric: true, hint: 'Conversations they resolved in the period' },
  { key: 'openNow', label: 'Open now', numeric: true, hint: 'Their conversations that are not resolved or snoozed today' },
  { key: 'firstReply', label: 'First reply', numeric: true, hint: 'Median time to the first reply they sent' },
  { key: 'resolution', label: 'Time to resolve', numeric: true, hint: 'Median time from opening to resolution' },
  { key: 'reopened', label: 'Reopened', numeric: true, hint: 'Their conversations reopened after being resolved' },
  { key: 'csat', label: 'Satisfaction', numeric: true, hint: 'Average rating out of 5' },
];

function sortValue(a: AgentRow, key: SortKey): number | string {
  switch (key) {
    case 'name': return a.name.toLowerCase();
    case 'assigned': return a.assigned;
    case 'resolved': return a.resolved;
    case 'openNow': return a.openNow;
    case 'reopened': return a.reopened;
    // Missing values sort last in either direction by using a sentinel the comparator handles below.
    case 'firstReply': return a.firstResponse.medianSeconds ?? Number.NaN;
    case 'resolution': return a.resolution.medianSeconds ?? Number.NaN;
    case 'csat': return a.csat.average ?? Number.NaN;
  }
}

function Sample({ n }: { n: number }) {
  return <span className={cn('block text-xs', n < LOW_SAMPLE ? 'text-amber-700' : 'text-gray-500')}>{n < LOW_SAMPLE ? `only ${n}` : `${n} samples`}</span>;
}

export default function TeamSection({ data }: { data: IntelligenceResponse }) {
  const [sortKey, setSortKey] = useState<SortKey>('resolved');
  const [descending, setDescending] = useState(true);

  const rows = useMemo(() => {
    const sorted = [...data.agents].sort((a, b) => {
      const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
      const aMissing = typeof av === 'number' && Number.isNaN(av), bMissing = typeof bv === 'number' && Number.isNaN(bv);
      if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return descending ? -cmp : cmp;
    });
    return sorted;
  }, [data.agents, sortKey, descending]);

  if (data.agents.length === 0) {
    return <EmptyNote title="No agent activity in this period">Conversations assigned to your team members will appear here.</EmptyNote>;
  }

  const chart = data.agents.slice(0, 8).map((a) => ({ name: a.name, Resolved: a.resolved, 'Open now': a.openNow }));
  const sortBy = (key: SortKey) => {
    if (key === sortKey) setDescending((d) => !d);
    else { setSortKey(key); setDescending(key !== 'name'); }
  };

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Resolved and still open, by agent</h3>
        <p className="text-sm text-gray-500 mb-3">Workload and output side by side. Verz AI is not included here: it has its own section below.</p>
        <div className="h-60" role="img" aria-label={`Resolved and open conversations for ${chart.length} agents. ${chart.map((c) => `${c.name}: ${c.Resolved} resolved, ${c['Open now']} open`).join('; ')}.`}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
            <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} />
              <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Resolved" fill="#0d9488" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Open now" fill="#94a3b8" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <caption className="sr-only">Team performance. Column headers sort the table.</caption>
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sortKey === c.key ? (descending ? 'descending' : 'ascending') : 'none'} className={cn('px-4 py-2.5 font-medium', c.numeric && 'text-right')}>
                    <button
                      type="button" onClick={() => sortBy(c.key)} title={c.hint}
                      className="inline-flex items-center gap-1 font-medium hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded"
                    >
                      {c.label}
                      <span aria-hidden="true" className="text-gray-400">{sortKey === c.key ? (descending ? '↓' : '↑') : ''}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((a) => (
                <tr key={a.agentId}>
                  <th scope="row" className="px-4 py-3 text-left font-medium text-gray-900">{a.name}</th>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.assigned)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.resolved)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.openNow)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {a.firstResponse.samples ? <>{formatDuration(a.firstResponse.medianSeconds)}<Sample n={a.firstResponse.samples} /></> : <span className="text-gray-400">n/a</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {a.resolution.samples ? <>{formatDuration(a.resolution.medianSeconds)}<Sample n={a.resolution.samples} /></> : <span className="text-gray-400">n/a</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(a.reopened)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {a.csat.average != null ? <>{a.csat.average}<Sample n={a.csat.responses} /></> : <span className="text-gray-400">n/a</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 px-4 py-3 border-t border-gray-200 bg-gray-50">
          This is a view of workload and speed, not a ranking. Times are medians, so one slow conversation does not distort them. Counts follow the current assignee of each conversation, and a time with fewer than {LOW_SAMPLE} samples is marked because it is too thin to compare fairly. Conversation difficulty and quality are not measured here.
        </p>
      </Panel>
    </div>
  );
}
