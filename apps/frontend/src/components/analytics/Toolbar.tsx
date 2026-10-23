'use client';
import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import type { ChannelFilter, RangePreset } from '@/lib/analytics/types';

export const PRESETS: Array<{ key: Exclude<RangePreset, 'custom'>; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
];

export const MAX_RANGE_DAYS = 366;

const CHANNELS: Array<{ key: ChannelFilter; label: string }> = [
  { key: 'ALL', label: 'All channels' },
  { key: 'WHATSAPP', label: 'WhatsApp' },
  { key: 'FACEBOOK_MESSENGER', label: 'Messenger' },
  { key: 'INSTAGRAM', label: 'Instagram' },
];

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

/** Returns an explanation when the custom range cannot be used, or null when it is fine. */
export function customRangeProblem(from: string, to: string, maxDays = MAX_RANGE_DAYS): string | null {
  if (!from || !to) return 'Choose both dates.';
  if (from > to) return 'The start date must be on or before the end date.';
  if (daysBetween(from, to) > maxDays) return `Choose a range of ${maxDays} days or fewer.`;
  return null;
}

interface Props {
  preset: RangePreset;
  /** Presets offered; defaults to all of them. */
  presets?: typeof PRESETS;
  /** Longest custom range accepted; defaults to the analytics limit. */
  maxDays?: number;
  refreshLabel?: string;
  customFrom: string;
  customTo: string;
  channel: ChannelFilter;
  showChannel: boolean;
  loading: boolean;
  onPreset: (preset: Exclude<RangePreset, 'custom'>) => void;
  onCustom: (from: string, to: string) => void;
  onChannel: (channel: ChannelFilter) => void;
  onRefresh: () => void;
  onExport?: () => void;
}

export default function Toolbar(p: Props) {
  const [customOpen, setCustomOpen] = useState(p.preset === 'custom');
  const [from, setFrom] = useState(p.customFrom);
  const [to, setTo] = useState(p.customTo);
  const problem = customOpen ? customRangeProblem(from, to, p.maxDays) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Date range" className="flex bg-gray-100 rounded-lg p-0.5">
          {(p.presets ?? PRESETS).map((x) => (
            <button
              key={x.key} role="radio" aria-checked={p.preset === x.key}
              onClick={() => { setCustomOpen(false); p.onPreset(x.key); }}
              className={cn('px-3 py-1.5 text-sm font-medium rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
                p.preset === x.key ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600 hover:text-gray-900')}
            >
              {x.label}
            </button>
          ))}
          <button
            role="radio" aria-checked={p.preset === 'custom'} onClick={() => setCustomOpen(true)}
            className={cn('px-3 py-1.5 text-sm font-medium rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
              p.preset === 'custom' ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600 hover:text-gray-900')}
          >
            Custom
          </button>
        </div>

        {p.showChannel && (
          <>
            <label htmlFor="analytics-channel" className="sr-only">Channel</label>
            <select
              id="analytics-channel" value={p.channel} onChange={(e) => p.onChannel(e.target.value as ChannelFilter)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </>
        )}

        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={p.onRefresh} disabled={p.loading} aria-label={p.refreshLabel ?? 'Refresh analytics'}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
          >
            <RefreshCw size={16} aria-hidden="true" className={p.loading ? 'animate-spin' : undefined} />
          </button>
          {p.onExport && (
            <Button variant="secondary" onClick={p.onExport}><Download size={14} aria-hidden="true" />Export CSV</Button>
          )}
        </div>
      </div>

      {customOpen && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); if (!problem) p.onCustom(from, to); }}
        >
          <label className="text-xs text-gray-600">
            <span className="block mb-1">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-2" />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-2" />
          </label>
          <Button type="submit" disabled={!!problem}>Apply</Button>
          {problem && (from || to) && <p role="alert" className="text-sm text-red-700 basis-full">{problem}</p>}
        </form>
      )}
    </div>
  );
}
