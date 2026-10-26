'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { greeting, freshness, DASHBOARD_MAX_DAYS } from '@/lib/dashboard/format';
import type { DashboardMeta, DashboardRange } from '@/lib/dashboard/types';
import Toolbar, { PRESETS } from '@/components/analytics/Toolbar';

const DASHBOARD_PRESETS = PRESETS.filter((p) => p.key !== '90d');

function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Header({ firstName, meta, range, loading, onPreset, onCustom, onRefresh }: {
  firstName: string;
  /** Null until the first answer arrives; the greeting then uses the signed-in person's first name. */
  meta: DashboardMeta | null;
  range: DashboardRange;
  loading: boolean;
  onPreset: (preset: '7d' | '30d' | 'today') => void;
  onCustom: (from: string, to: string) => void;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const fresh = meta ? freshness(meta.generatedAt, now) : null;
  const who = meta?.workspaceName || firstName;

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 tracking-tight">{greeting(meta?.timezone)}{who ? `, ${who}` : ''}</h1>
          <p className="text-sm text-gray-600 mt-1">Here&apos;s what&apos;s happening with your business today.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onRefresh} disabled={loading} aria-label="Refresh dashboard"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
          >
            <RefreshCw size={18} aria-hidden="true" className={cn(loading && 'animate-spin')} />
          </button>
          {fresh && meta && (
            <p role="status" className={cn('text-xs leading-tight', fresh.stale ? 'text-amber-700' : 'text-gray-500')}>
              {fresh.stale ? <span className="flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" />Data is from {fresh.text}</span> : 'Last updated'}
              <span className={cn('block text-gray-700', fresh.stale && 'text-amber-700')}>{stamp(meta.generatedAt)}</span>
            </p>
          )}
        </div>
      </div>
      <Toolbar
        preset={range.preset}
        presets={DASHBOARD_PRESETS}
        maxDays={DASHBOARD_MAX_DAYS}
        hideRefresh
        customIcon
        customFrom={range.from}
        customTo={range.to}
        channel="ALL"
        showChannel={false}
        loading={loading}
        onPreset={(p) => onPreset(p as '7d' | '30d' | 'today')}
        onCustom={onCustom}
        onChannel={() => undefined}
        onRefresh={onRefresh}
      />
    </header>
  );
}
