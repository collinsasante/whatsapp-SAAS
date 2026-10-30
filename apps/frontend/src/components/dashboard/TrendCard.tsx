'use client';
import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber } from '@/lib/analytics/format';
import { bucketLabel } from '@/lib/dashboard/format';
import type { DashboardTrend } from '@/lib/dashboard/types';
import { EmptyNote } from '@/components/analytics/ui';

const OPENED = '#0d9488';
const RESOLVED = '#3b82f6';

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-gray-900">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-gray-700">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span><span className="ml-auto pl-3 font-medium tabular-nums">{formatNumber(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Conversations opened and resolved over the chosen period, with the period's totals underneath. `showTable` swaps the chart for the same numbers as a table. */
export default function TrendCard({ data, showTable }: { data: DashboardTrend; showTable: boolean }) {
  const { granularity } = data.meta;
  const unit = granularity === 'hour' ? 'hour' : 'day';
  const points = useMemo(() => data.points.map((p) => ({ ...p, label: bucketLabel(p.bucket, granularity) })), [data.points, granularity]);
  const sum = (key: 'opened' | 'resolved' | 'inbound') => points.reduce((n, p) => n + p[key], 0);
  const opened = sum('opened');
  const resolved = sum('resolved');
  const messages = sum('inbound');
  const hasData = opened > 0 || resolved > 0;

  return (
    <div>
      {!hasData ? (
        <EmptyNote title="No conversations opened or resolved in this period">Pick a longer date range to see a trend.</EmptyNote>
      ) : showTable ? (
        <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <caption className="sr-only">Conversations opened and resolved by {unit}</caption>
            <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">{granularity === 'hour' ? 'Hour' : 'Date'}</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Opened</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.bucket} className="border-t border-gray-100">
                  <th scope="row" className="px-3 py-1 font-normal text-gray-700">{p.label}</th>
                  <td className="px-3 py-1 text-right tabular-nums">{formatNumber(p.opened)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatNumber(p.resolved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="h-56 sm:h-64" role="img" aria-label={`Conversations by ${unit}: ${formatNumber(opened)} opened, ${formatNumber(resolved)} resolved.`}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 260 }}>
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.25)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: 'rgba(148,163,184,0.4)' }} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="linear" dataKey="opened" name="Opened" stroke={OPENED} strokeWidth={2} dot={points.length <= 31 ? { r: 2.5 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
                <Line type="linear" dataKey="resolved" name="Resolved" stroke={RESOLVED} strokeWidth={2} strokeDasharray="5 3" dot={points.length <= 31 ? { r: 2.5 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600" aria-label="Legend">
            <li className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: OPENED }} />Opened</li>
            <li className="inline-flex items-center gap-2">
              <svg width="20" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" stroke={RESOLVED} strokeWidth="2" strokeDasharray="5 3" /><circle cx="10" cy="4" r="2.5" fill={RESOLVED} /></svg>
              Resolved
            </li>
          </ul>
        </>
      )}

      <dl className="mt-4 grid grid-cols-3 divide-x divide-gray-200 rounded-lg bg-gray-50 py-3" aria-label="Totals for this period">
        {([['Opened', opened], ['Resolved', resolved], ['Customer messages', messages]] as const).map(([label, value]) => (
          <div key={label} className="px-4 first:pl-4">
            <dd className="text-xl font-semibold tabular-nums text-gray-900">{formatNumber(value)}</dd>
            <dt className="text-xs text-gray-500">{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}
