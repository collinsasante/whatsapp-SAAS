'use client';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { channelName, formatNumber } from '@/lib/analytics/format';
import { bucketLabel } from '@/lib/dashboard/format';
import type { DashboardTrend } from '@/lib/dashboard/types';
import { BarRow, EmptyNote } from '@/components/analytics/ui';

type View = 'conversations' | 'messages' | 'customers' | 'channels';

const VIEWS: Array<{ key: View; label: string; blurb: string }> = [
  { key: 'conversations', label: 'Conversations', blurb: 'Conversations opened and resolved' },
  { key: 'messages', label: 'Messages', blurb: 'Messages received and sent' },
  { key: 'customers', label: 'Customers', blurb: 'Conversations from new and returning customers' },
  { key: 'channels', label: 'Channels', blurb: 'Conversations opened on each channel' },
];

const TEAL = '#0d9488';
const SLATE = '#334155';
const AMBER = '#d97706';

interface SeriesDef { key: string; name: string; color: string }

const SERIES: Record<Exclude<View, 'channels'>, SeriesDef[]> = {
  conversations: [{ key: 'opened', name: 'Opened', color: TEAL }, { key: 'resolved', name: 'Resolved', color: SLATE }],
  messages: [{ key: 'inbound', name: 'Received', color: TEAL }, { key: 'outbound', name: 'Sent', color: SLATE }],
  customers: [{ key: 'newCustomers', name: 'New customers', color: TEAL }, { key: 'returningCustomers', name: 'Returning customers', color: AMBER }],
};

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-md px-3 py-2 text-xs">
      <p className="font-semibold text-gray-900 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-gray-700">
          <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}</span><span className="ml-auto pl-3 font-medium tabular-nums">{formatNumber(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export default function TrendCard({ data }: { data: DashboardTrend }) {
  const [view, setView] = useState<View>('conversations');
  const [table, setTable] = useState(false);
  const { granularity } = data.meta;
  const points = useMemo(
    () => data.points.map((p) => ({ ...p, label: bucketLabel(p.bucket, granularity) })),
    [data.points, granularity],
  );
  const info = VIEWS.find((v) => v.key === view)!;
  const defs = view === 'channels' ? [] : SERIES[view];
  const total = (key: string) => points.reduce((sum, p) => sum + Number((p as unknown as Record<string, number>)[key]), 0);
  const hasData = view === 'channels'
    ? data.channels.some((c) => c.conversations > 0)
    : defs.some((d) => total(d.key) > 0);
  const channelMax = Math.max(0, ...data.channels.map((c) => c.conversations));
  const unit = granularity === 'hour' ? 'hour' : 'day';

  const sum = (key: 'opened' | 'resolved' | 'inbound') => points.reduce((n, p) => n + p[key], 0);
  return (
    <div>
      <dl className="mb-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200" aria-label="Totals for this period">
        {([['Opened', sum('opened')], ['Resolved', sum('resolved')], ['Customer messages', sum('inbound')]] as const).map(([label, value]) => (
          <div key={label} className="bg-white px-3 py-2">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-gray-900">{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
      <div role="tablist" aria-label="Measure shown in the chart" className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-0.5 w-fit max-w-full mb-3">
        {VIEWS.map((v) => (
          <button
            key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
            className={cn('px-3 py-1.5 text-sm font-medium rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
              view === v.key ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600 hover:text-gray-900')}
          >
            {v.label}
          </button>
        ))}
      </div>

      {!hasData ? (
        <EmptyNote title={`No ${info.label.toLowerCase()} activity in this period`}>
          Pick a longer date range to see a trend.
        </EmptyNote>
      ) : view === 'channels' ? (
        <>
          <p className="text-sm text-gray-600 mb-2">{info.blurb}. Channels with no conversations are still listed so you can see what is not producing.</p>
          <ul>
            {data.channels.map((c) => (
              <BarRow
                key={c.channel} label={channelName(c.channel)} value={c.conversations} max={channelMax}
                sub={c.previousConversations > 0 || c.conversations > 0 ? `${formatNumber(c.previousConversations)} before` : undefined}
              />
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-2">{info.blurb}, by {unit}.</p>
          <div className="h-56 sm:h-60" role="img" aria-label={`${info.label} by ${unit}: ${defs.map((d) => `${formatNumber(total(d.key))} ${d.name.toLowerCase()}`).join(', ')}.`}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 260 }}>
              {view === 'customers' ? (
                <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                  {defs.map((d) => <Bar key={d.key} dataKey={d.key} name={d.name} stackId="customers" fill={d.color} isAnimationActive={false} />)}
                </BarChart>
              ) : (
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<ChartTooltip />} />
                  {defs.map((d, i) => (
                    <Line
                      key={d.key} type="linear" dataKey={d.key} name={d.name} stroke={d.color} strokeWidth={2}
                      strokeDasharray={i === 1 ? '5 3' : undefined}
                      dot={points.length <= 31 ? { r: 2 } : false} activeDot={{ r: 4 }} isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600" aria-label="Legend">
              {defs.map((d, i) => (
                <li key={d.key} className="inline-flex items-center gap-2">
                  <svg width="18" height="8" aria-hidden="true">
                    {view === 'customers'
                      ? <rect x="0" y="0" width="18" height="8" rx="1.5" fill={d.color} />
                      : <line x1="0" y1="4" x2="18" y2="4" stroke={d.color} strokeWidth="2" strokeDasharray={i === 1 ? '5 3' : undefined} />}
                  </svg>
                  {d.name}
                </li>
              ))}
            </ul>
            <button onClick={() => setTable((v) => !v)} aria-expanded={table} className="text-xs font-medium text-teal-700 hover:underline">
              {table ? 'Hide data table' : 'Show data table'}
            </button>
          </div>
          {table && (
            <div className="mt-2 max-h-56 overflow-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <caption className="sr-only">{info.label} by {unit}</caption>
                <thead className="bg-gray-50 text-left text-gray-600 sticky top-0">
                  <tr><th scope="col" className="px-3 py-1.5 font-medium">{granularity === 'hour' ? 'Hour' : 'Date'}</th>
                    {defs.map((d) => <th key={d.key} scope="col" className="px-3 py-1.5 font-medium text-right">{d.name}</th>)}</tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.bucket} className="border-t border-gray-100">
                      <th scope="row" className="px-3 py-1 font-normal text-gray-700">{p.label}</th>
                      {defs.map((d) => <td key={d.key} className="px-3 py-1 text-right tabular-nums">{formatNumber((p as unknown as Record<string, number>)[d.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
