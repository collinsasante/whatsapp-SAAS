'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { greeting, freshness } from '@/lib/dashboard/format';
import { formatRange } from '@/lib/analytics/format';
import type { DashboardMeta, DashboardRange } from '@/lib/dashboard/types';
import PageHeader from '@/components/ui/PageHeader';
import Toolbar, { PRESETS } from '@/components/analytics/Toolbar';
import { DASHBOARD_MAX_DAYS } from '@/lib/dashboard/format';

const DASHBOARD_PRESETS = PRESETS.filter((p) => p.key !== '90d');

export default function Header({ firstName, meta, range, loading, onPreset, onCustom, onRefresh }: {
  firstName: string;
  /** Null until the first answer arrives; the greeting then falls back to the browser clock. */
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

  return (
    <header className="flex flex-col gap-4">
      <PageHeader
        title={<>{greeting(meta?.timezone)}{firstName ? `, ${firstName}` : ''}</>}
        description={
          <>
            {meta?.workspaceName ? <span className="font-medium text-gray-800">{meta.workspaceName}</span> : null}
            {meta ? <span>{meta.workspaceName ? ' business overview, ' : 'Business overview, '}{formatRange(meta.from, meta.to)}{meta.timezone ? ` (${meta.timezone})` : ''}</span> : <span>Loading your workspace</span>}
          </>
        }
        actions={fresh && (
          <p className={fresh.stale ? 'text-sm text-amber-700 flex items-center gap-1.5' : 'text-sm text-gray-500'} role="status">
            {fresh.stale && <AlertTriangle size={14} aria-hidden="true" />}
            {fresh.stale ? `Data is from ${fresh.text}. Refresh to update it.` : `Updated ${fresh.text}`}
          </p>
        )}
      />
      <Toolbar
        preset={range.preset}
        presets={DASHBOARD_PRESETS}
        maxDays={DASHBOARD_MAX_DAYS}
        refreshLabel="Refresh dashboard"
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
