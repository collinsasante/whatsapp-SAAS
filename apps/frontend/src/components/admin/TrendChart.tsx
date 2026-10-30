'use client';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface TrendSeries { key: string; name: string; color: string; dashed?: boolean }

function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function Tip({ active, payload, label, format }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-gray-200 bg-white shadow-md px-2.5 py-1.5 text-xs">
      <p className="font-semibold text-gray-900 mb-0.5">{label ? formatDay(label) : ''}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-gray-700">
          <span aria-hidden="true" className="inline-block w-2.5 h-0.5" style={{ background: p.color }} />{p.name}
          <span className="ml-auto pl-3 font-medium tabular-nums">{format(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** A line chart over dates. `summary` is read aloud in place of the picture. */
export function TrendChart({ data, series, summary, height = 220, format = (v) => v.toLocaleString() }: {
  data: Array<Record<string, number | string>>;
  series: TrendSeries[];
  summary: string;
  height?: number;
  format?: (value: number) => string;
}) {
  return (
    <div style={{ height }} role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: height }}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} minTickGap={32} />
          <YAxis tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <Tooltip content={<Tip format={format} />} />
          {series.map((s) => (
            <Line key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? '4 4' : undefined} dot={data.length <= 31 ? { r: 2 } : false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
