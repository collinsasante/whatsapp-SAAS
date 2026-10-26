'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { formatDay } from '@/lib/analytics/format';
import { formatMoney } from '@/lib/commerce/format';
import type { RevenuePoint } from '@/lib/commerce/types';

type Measure = 'gross' | 'net' | 'refunded';
const MEASURES: Array<{ key: Measure; label: string; color: string }> = [
  { key: 'gross', label: 'Gross sales', color: '#0d9488' },
  { key: 'net', label: 'You keep', color: '#334155' },
  { key: 'refunded', label: 'Refunded', color: '#dc2626' },
];

function Tip({ active, payload, label, currency }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; currency: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-0.5 font-semibold text-gray-900">{label}</p>
      <p className="tabular-nums text-gray-700">{formatMoney(payload[0].value, currency)}</p>
    </div>
  );
}

/** One measure per day. A table with the same figures is always in the page for screen readers. */
export default function RevenueChart({ series, currency }: { series: RevenuePoint[]; currency: string }) {
  const [measure, setMeasure] = useState<Measure>('gross');
  const def = MEASURES.find((m) => m.key === measure)!;
  const data = series.map((p) => ({ day: formatDay(p.date), value: p[measure] }));
  const hasAny = series.some((p) => p.gross !== 0 || p.refunded !== 0);

  return (
    <div>
      <div role="radiogroup" aria-label="Chart shows" className="inline-flex rounded-lg bg-gray-100 p-0.5">
        {MEASURES.map((m) => (
          <button
            key={m.key} type="button" role="radio" aria-checked={measure === m.key} onClick={() => setMeasure(m.key)}
            className={cn('rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
              measure === m.key ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600 hover:text-gray-900')}
          >{m.label}</button>
        ))}
      </div>

      {hasAny ? (
        <div className="mt-3 h-64" role="img" aria-label={`${def.label} for each day`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.3)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} axisLine={false} width={56} allowDecimals />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.15)' }} content={<Tip currency={currency} />} />
              <Bar dataKey="value" fill={def.color} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">Nothing was sold or refunded on any day in this period.</p>
      )}

      <table className="sr-only">
        <caption>Daily figures in {currency}</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Gross sales</th><th scope="col">Refunded</th><th scope="col">You keep</th></tr></thead>
        <tbody>{series.map((p) => <tr key={p.date}><th scope="row">{formatDay(p.date)}</th><td>{p.gross.toFixed(2)}</td><td>{p.refunded.toFixed(2)}</td><td>{p.net.toFixed(2)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
