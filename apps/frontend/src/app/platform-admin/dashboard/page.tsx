'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { adminApi } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatGhs, formatNumber, trailingRange } from '@/lib/admin/format';
import { PageHeader, Section } from '@/components/admin/PageHeader';
import { MetricStrip, type Metric } from '@/components/admin/MetricStrip';
import { AttentionPanel } from '@/components/admin/AttentionPanel';
import { AuditList } from '@/components/admin/AuditList';
import { TrendChart } from '@/components/admin/TrendChart';
import { EmptyState, ErrorState, Skeleton, Unavailable } from '@/components/admin/States';
import { cn } from '@/lib/utils';

const RANGES = [{ key: '7d', days: 7, label: '7 days' }, { key: '30d', days: 30, label: '30 days' }, { key: '90d', days: 90, label: '90 days' }];

type GrowthMeasure = 'newTenants' | 'totalTenants' | 'activeSubscriptions' | 'mrrGhs';
const MEASURES: Array<{ key: GrowthMeasure; label: string; series: string }> = [
  { key: 'newTenants', label: 'New tenants', series: 'New tenants per day' },
  { key: 'totalTenants', label: 'All tenants', series: 'Tenants' },
  { key: 'activeSubscriptions', label: 'Paying subscriptions', series: 'Active subscriptions' },
  { key: 'mrrGhs', label: 'MRR', series: 'MRR (GHS)' },
];

const MOVEMENT_LABEL: Record<string, string> = { NEW: 'New', EXPANSION: 'Expansion', CONTRACTION: 'Contraction', CHURNED: 'Churned' };

export default function PlatformOverviewPage() {
  const url = useUrlState({ range: '30d' });
  const range = RANGES.find((r) => r.key === url.get('range')) ?? RANGES[1];
  const { from, to } = useMemo(() => trailingRange(range.days), [range.days]);

  const overview = useAdminData(() => adminApi.overview(from, to), [from, to]);
  const growth = useAdminData(() => adminApi.growth(from, to), [from, to]);
  const attention = useAdminData(() => adminApi.attention(), []);
  const totals = useAdminData(() => adminApi.dashboard(), []);
  const ai = useAdminData(() => adminApi.aiUsageTopConsumers(from, to), [from, to]);
  const messaging = useAdminData(() => adminApi.messagingAnalytics(from, to), [from, to]);
  const audit = useAdminData(() => adminApi.auditLogs({ limit: 8 }), []);
  const [measure, setMeasure] = useState<GrowthMeasure>('newTenants');

  const all = [overview, growth, attention, totals, ai, messaging, audit];
  const refreshing = all.some((q) => q.loading);
  const reloadAll = () => all.forEach((q) => q.reload());

  const g = growth.data;
  const rollupReady = !!g && g.rollup.latestDate !== null;
  const lastPoint = g?.series[g.series.length - 1];
  const o = overview.data;

  const metrics: Metric[] = [
    {
      label: 'Tenants', value: totals.data ? formatNumber(totals.data.totalTenants) : null, unavailable: totals.error ? 'Could not load' : 'Loading',
      hint: 'Every workspace that has ever been created on the platform, including suspended ones.',
      detail: g ? (g.totals.previousNewTenants == null ? `${g.totals.newTenants} new in this period` : `${g.totals.newTenants} new, ${g.totals.previousNewTenants} in the period before`) : undefined,
      href: '/platform-admin/workspaces',
    },
    {
      label: 'Paying tenants', value: o && rollupReady ? formatNumber(o.activePayingTenants) : null, unavailable: rollupReady ? 'Loading' : 'Rollup has not run yet',
      hint: 'Tenants with an active or past-due subscription, as of the latest daily rollup.',
      detail: o && rollupReady ? `ARPU ${formatGhs(o.arpuGhs)}` : undefined, href: '/platform-admin/workspaces?status=active',
    },
    {
      label: 'Trials in progress', value: o && rollupReady ? formatNumber(o.trialsInProgress) : null, unavailable: rollupReady ? 'Loading' : 'Rollup has not run yet',
      hint: 'Tenants currently on a free trial, as of the latest daily rollup.',
      detail: o?.trialToPaidConversionRate != null ? `${Math.round(o.trialToPaidConversionRate * 100)}% convert to paid` : o ? 'Conversion not available yet' : undefined,
      href: '/platform-admin/workspaces?status=trial',
    },
    {
      label: 'MRR', value: o && rollupReady ? formatGhs(o.mrr.amountGhs) : null, unavailable: rollupReady ? 'Loading' : 'Rollup has not run yet',
      hint: 'Monthly recurring revenue from the list prices of active and past-due subscriptions, at a fixed estimated exchange rate for USD plans. It is not cash collected: past-due plans count in full, and plans assigned without payment count at their list price.',
      change: o && rollupReady ? { ratio: o.mrr.changePct == null ? null : o.mrr.changePct / 100, upIsGood: true } : undefined, href: '/platform-admin/billing',
    },
    {
      label: 'Users', value: totals.data ? formatNumber(totals.data.totalUsers) : null, unavailable: totals.error ? 'Could not load' : 'Loading',
      hint: 'All user accounts across every tenant.', detail: g ? `${formatNumber(g.totals.newUsers)} joined in this period` : undefined, href: '/platform-admin/users',
    },
    {
      label: 'Monthly active users', value: lastPoint ? formatNumber(lastPoint.mau) : null, unavailable: growth.error ? 'Could not load' : growth.loading ? 'Loading' : 'No rollup data in this period',
      hint: 'People who signed in during the last 30 days, counted from sign-in records. Someone who stays signed in without signing in again is not counted.',
      detail: lastPoint ? `${formatNumber(lastPoint.dau)} signed in on the latest day` : undefined,
    },
    {
      label: 'Messages sent', value: messaging.data ? formatNumber(messaging.data.totals.sent) : null, unavailable: messaging.error ? 'Could not load' : 'Loading',
      hint: 'Outbound messages sent by all tenants in this period.',
      detail: messaging.data && messaging.data.totals.sent > 0 ? `${formatNumber(messaging.data.totals.failed)} failed (${Math.round((messaging.data.totals.failed / messaging.data.totals.sent) * 1000) / 10}%)` : undefined,
      href: '/platform-admin/messaging',
    },
    {
      label: 'AI credits used', value: ai.data ? formatNumber(ai.data.totals.creditsConsumed) : null, unavailable: ai.error ? 'Could not load' : 'Loading',
      hint: 'Credits consumed by Verz AI across every tenant in this period.',
      detail: ai.data ? `${ai.data.totals.tenants} ${ai.data.totals.tenants === 1 ? 'tenant' : 'tenants'} used AI` : undefined, href: '/platform-admin/ai/usage',
    },
  ];

  const chartRows = g?.series.map((p) => ({ ...p })) ?? [];
  const measureInfo = MEASURES.find((m) => m.key === measure)!;
  const movement = o?.mrrMovement;

  return (
    <div>
      <PageHeader
        title="Platform overview"
        description="How VerzChat is doing as a business, and what needs doing today."
        actions={
          <>
            <div role="radiogroup" aria-label="Period" className="flex bg-gray-100 rounded-md p-0.5">
              {RANGES.map((r) => (
                <button key={r.key} role="radio" aria-checked={range.key === r.key} onClick={() => url.set({ range: r.key })}
                  className={cn('px-2.5 py-1.5 text-sm font-medium rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600', range.key === r.key ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
                  {r.label}
                </button>
              ))}
            </div>
            <button onClick={reloadAll} disabled={refreshing} aria-label="Refresh" className="w-9 h-9 inline-flex items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} aria-hidden="true" />
            </button>
          </>
        }
      />

      <Section title="Needs attention" description="Conditions the platform can detect, each linked to where it is handled." id="attention">
        <AttentionPanel data={attention.data} loading={attention.loading} error={attention.error} onRetry={attention.reload} />
      </Section>

      <Section title="Key numbers" description={`${from} to ${to}, compared with the period before where a comparison exists.`} id="metrics">
        <MetricStrip metrics={metrics} />
      </Section>

      <Section title="Growth" id="growth" description="From the platform's daily rollup, which runs hourly.">
        {growth.error && !g ? <div className="rounded-lg border border-gray-200 bg-white"><ErrorState message={growth.error} onRetry={growth.reload} /></div> : !g ? <Skeleton className="h-64 w-full" /> : (
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            {g.rollup.stale && (
              <div className="mb-3"><Unavailable>{g.rollup.latestDate ? `The daily rollup last ran for ${g.rollup.latestDate}, so the end of this period has no data yet.` : 'The daily rollup has not produced any data yet, so growth cannot be shown.'}</Unavailable></div>
            )}
            {chartRows.length === 0 ? <EmptyState title="No rollup data in this period" /> : (
              <>
                <div role="tablist" aria-label="Measure" className="flex flex-wrap gap-1 mb-3">
                  {MEASURES.map((m) => (
                    <button key={m.key} role="tab" aria-selected={measure === m.key} onClick={() => setMeasure(m.key)}
                      className={cn('px-2.5 py-1 text-sm rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600', measure === m.key ? 'bg-teal-50 text-teal-800 font-medium' : 'text-gray-600 hover:bg-gray-100')}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <TrendChart
                  data={chartRows} series={[{ key: measure, name: measureInfo.series, color: '#0f766e' }]}
                  format={measure === 'mrrGhs' ? (v) => formatGhs(v) : undefined}
                  summary={`${measureInfo.series} from ${chartRows[0].date} to ${chartRows[chartRows.length - 1].date}. Latest value ${chartRows[chartRows.length - 1][measure]}.`}
                />
              </>
            )}
          </div>
        )}
      </Section>

      <div className="grid lg:grid-cols-5 gap-x-8">
        <div className="lg:col-span-3">
          <Section title="Where MRR moved" id="movement" description="Change in recurring revenue per tenant between the first and last day of the period.">
            {overview.error && !o ? <div className="rounded-lg border border-gray-200 bg-white"><ErrorState message={overview.error} onRetry={overview.reload} /></div> : !movement ? <Skeleton className="h-40 w-full" /> : (
              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <caption className="sr-only">MRR movement by category</caption>
                  <thead><tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600"><th scope="col" className="text-left font-medium px-3 py-2">Movement</th><th scope="col" className="text-right font-medium px-3 py-2">Tenants</th><th scope="col" className="text-right font-medium px-3 py-2">MRR (GHS)</th><th scope="col" className="text-left font-medium px-3 py-2">Examples</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {(['NEW', 'EXPANSION', 'CONTRACTION', 'CHURNED'] as const).map((k) => (
                      <tr key={k}>
                        <th scope="row" className="text-left font-medium text-gray-900 px-3 py-2">{MOVEMENT_LABEL[k]}</th>
                        <td className="px-3 py-2 text-right tabular-nums">{movement[k].count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGhs(movement[k].amountGhs)}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {movement[k].tenants.slice(0, 3).map((t, i) => <span key={t.tenantId}>{i > 0 && ', '}<Link href={`/platform-admin/workspaces/${t.tenantId}`} className="text-teal-700 hover:underline">{t.tenantName}</Link></span>)}
                          {movement[k].tenants.length === 0 && <span className="text-gray-400">None</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-500 px-3 py-2 border-t border-gray-100 bg-gray-50">
                  Net revenue retention {o.netRevenueRetention != null ? `${Math.round(o.netRevenueRetention * 100)}%` : 'is not available yet'} · logo churn {o.logoChurnRate != null ? `${Math.round(o.logoChurnRate * 1000) / 10}%` : 'is not available yet'}
                </p>
              </div>
            )}
          </Section>
        </div>
        <div className="lg:col-span-2">
          <Section title="Recent admin activity" id="activity" actions={<Link href="/platform-admin/audit-logs" className="text-xs text-teal-700 hover:underline">Full audit log</Link>}>
            <div className="rounded-lg border border-gray-200 bg-white px-3">
              {audit.error && !audit.data ? <ErrorState message={audit.error} onRetry={audit.reload} /> : !audit.data ? <div className="py-3 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div> : <AuditList rows={audit.data.items} compact />}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
