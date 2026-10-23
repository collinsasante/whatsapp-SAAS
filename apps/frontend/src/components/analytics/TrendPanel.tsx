'use client';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { formatNumber, toTrendPoints, type TrendPoint } from '@/lib/analytics/format';
import type { IntelligenceResponse } from '@/lib/analytics/types';
import { EmptyNote, Panel } from './ui';

type Measure = 'conversations' | 'contacts' | 'messages';

const MEASURES: Array<{ key: Measure; label: string; description: string }> = [
  { key: 'conversations', label: 'Conversations', description: 'Opened and resolved' },
  { key: 'contacts', label: 'New contacts', description: 'People reaching you for the first time' },
  { key: 'messages', label: 'Customer messages', description: 'Messages received from customers' },
];

const TEAL = '#0d9488';
const SLATE = '#334155';
const GREY = '#9ca3af';

interface SeriesDef {
  key: keyof TrendPoint;
  name: string;
  color: string;
  dashed?: boolean;
}

function seriesFor(measure: Measure, compare: boolean): SeriesDef[] {
  if (measure === 'conversations') {
    const base: SeriesDef[] = [
      { key: 'opened', name: 'Opened', color: TEAL },
      { key: 'resolved', name: 'Resolved', color: SLATE },
    ];
    return compare ? [...base, { key: 'previousOpened', name: 'Opened, previous period', color: GREY, dashed: true }] : base;
  }
  if (measure === 'contacts') return [{ key: 'newContacts', name: 'New contacts', color: TEAL }];
  return [{ key: 'inbound', name: 'Customer messages', color: TEAL }];
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-md px-3 py-2 text-xs">
      <p className="font-semibold text-gray-900 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-gray-700">
          <span aria-hidden="true" className="inline-block w-2.5 h-0.5" style={{ background: p.color }} />
          <span>{p.name}</span><span className="ml-auto pl-3 font-medium tabular-nums">{formatNumber(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export default function TrendPanel({ data }: { data: IntelligenceResponse }) {
  const [measure, setMeasure] = useState<Measure>('conversations');
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const [compare, setCompare] = useState(true);

  const canWeek = data.meta.days >= 14;
  const effective = canWeek ? granularity : 'day';
  const points = useMemo(() => toTrendPoints(data.series, effective), [data.series, effective]);
  const defs = seriesFor(measure, compare);
  const hasData = points.some((p) => defs.some((d) => Number(p[d.key]) > 0));
  const measureInfo = MEASURES.find((m) => m.key === measure)!;
  const total = points.reduce((sum, p) => sum + Number(p[defs[0].key]), 0);

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div role="tablist" aria-label="Measure shown in the chart" className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {MEASURES.map((m) => (
            <button
              key={m.key} role="tab" aria-selected={measure === m.key} onClick={() => setMeasure(m.key)}
              className={cn('px-3 py-1.5 text-sm font-medium rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
                measure === m.key ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600 hover:text-gray-900')}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {measure === 'conversations' && (
            <label className="inline-flex items-center gap-2 text-gray-700 cursor-pointer">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="rounded border-gray-300 text-teal-600 focus:ring-teal-600" />
              Compare with previous period
            </label>
          )}
          {canWeek && (
            <div role="group" aria-label="Group by" className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {(['day', 'week'] as const).map((g) => (
                <button
                  key={g} aria-pressed={effective === g} onClick={() => setGranularity(g)}
                  className={cn('px-2.5 py-1 text-xs font-medium rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
                    effective === g ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600')}
                >
                  {g === 'day' ? 'Daily' : 'Weekly'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!hasData ? (
        <EmptyNote title={`No ${measureInfo.label.toLowerCase()} in this period`}>
          Try a longer date range{data.meta.channel === 'ALL' ? '' : ' or another channel'}.
        </EmptyNote>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-2">
            {measureInfo.description} each {effective}. <span className="font-medium text-gray-900 tabular-nums">{formatNumber(total)}</span> in total this period.
          </p>
          <div className="h-64 sm:h-72" role="img" aria-label={`${measureInfo.label} over time: ${formatNumber(total)} in total, grouped by ${effective}.`}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 260 }}>
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} minTickGap={28} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<ChartTooltip />} />
                {defs.map((d) => (
                  <Line
                    key={d.key} type="linear" dataKey={d.key} name={d.name} stroke={d.color} strokeWidth={d.dashed ? 1.5 : 2}
                    strokeDasharray={d.dashed ? '4 4' : undefined} dot={points.length <= 31 ? { r: 2 } : false} activeDot={{ r: 4 }} isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-gray-600" aria-label="Legend">
            {defs.map((d) => (
              <li key={d.key} className="inline-flex items-center gap-2">
                <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke={d.color} strokeWidth="2" strokeDasharray={d.dashed ? '4 3' : undefined} /></svg>
                {d.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
