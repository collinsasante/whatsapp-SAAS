import React, { useState } from 'react';
import { cn } from '@/lib/utils';

export type DateRangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'thisYear', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
];

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function rangeForPreset(preset: DateRangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  const to = fmt(today);
  switch (preset) {
    case 'custom':
      return { from: customFrom || to, to: customTo || to };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y) };
    }
    case 'thisMonth': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: fmt(start), to };
    }
    case 'lastMonth': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: fmt(start), to: fmt(end) };
    }
    case 'thisYear': {
      const start = new Date(today.getFullYear(), 0, 1);
      return { from: fmt(start), to };
    }
    default: {
      const daysBack = preset === 'today' ? 0 : preset === '7d' ? 6 : 29;
      const from = new Date(today);
      from.setDate(from.getDate() - daysBack);
      return { from: fmt(from), to };
    }
  }
}

/**
 * Generalizes the preset+custom date-range pattern that previously lived
 * inline in the tenant-app analytics page (Today/7d/30d/90d/Custom) into a
 * shared component with the wider preset set the admin plan calls for, and
 * an internal state so callers just consume {from, to}.
 */
export function DateRangePicker({ onChange, className }: { onChange: (range: { from: string; to: string }) => void; className?: string }) {
  const [preset, setPreset] = useState<DateRangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const select = (p: DateRangePreset) => {
    setPreset(p);
    if (p !== 'custom') onChange(rangeForPreset(p, customFrom, customTo));
  };

  const applyCustom = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    if (from && to) onChange({ from, to });
  };

  return (
    <div className={className}>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => select(p.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              preset === p.key ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => applyCustom(e.target.value, customTo)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => applyCustom(customFrom, e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
          />
        </div>
      )}
    </div>
  );
}
