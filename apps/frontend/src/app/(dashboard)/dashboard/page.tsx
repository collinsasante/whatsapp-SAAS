'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Table2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getPermissions } from '@/lib/permissions';
import { UserRole } from '@whatsapp-platform/shared-types';
import { useWidget } from '@/lib/dashboard/useWidget';
import {
  DASHBOARD_MAX_DAYS, DEFAULT_PRESET, PRESET_KEYS, rangeKey, rangeQuery,
} from '@/lib/dashboard/format';
import type {
  DashboardAttention, DashboardBusiness, DashboardPreset, DashboardRange, DashboardSummary,
  DashboardTrend, DashboardWhatsAppStatus,
} from '@/lib/dashboard/types';
import { customRangeProblem } from '@/components/analytics/Toolbar';
import { EmptyNote, Skeleton } from '@/components/analytics/ui';
import Header from '@/components/dashboard/Header';
import WidgetCard from '@/components/dashboard/WidgetCard';
import KpiCards from '@/components/dashboard/KpiCards';
import TrendCard from '@/components/dashboard/TrendCard';
import AlertTiles from '@/components/dashboard/AlertTiles';
import BusinessCard from '@/components/dashboard/BusinessCard';
import WhatsAppCard, { whatsappHeadline } from '@/components/dashboard/WhatsAppCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/fields';

/** How often the page refreshes itself while it is open and visible. */
const AUTO_REFRESH_MS = 5 * 60_000;

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname() ?? '/dashboard';
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const permissions = getPermissions(user?.role as UserRole | undefined);
  const canView = permissions.showDashboard;

  // The range lives in the address, so a view can be shared and the back button works.
  const rawPreset = searchParams?.get('range');
  const preset: DashboardPreset = PRESET_KEYS.includes(rawPreset as DashboardPreset) ? (rawPreset as DashboardPreset) : DEFAULT_PRESET;
  const from = searchParams?.get('from') ?? '';
  const to = searchParams?.get('to') ?? '';
  const customProblem = preset === 'custom' ? customRangeProblem(from, to, DASHBOARD_MAX_DAYS) : null;
  const range: DashboardRange = useMemo(() => ({ preset, from, to }), [preset, from, to]);
  const key = rangeKey(range);
  const enabled = canView && customProblem === null;

  const setParams = useCallback((next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [k, v] of Object.entries(next)) { if (v == null || v === '') params.delete(k); else params.set(k, v); }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const [showTrendTable, setShowTrendTable] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  const query = rangeQuery(range);
  const opts = { enabled, refreshKey };
  const summary = useWidget<DashboardSummary>(key, (s) => dashboardApi.summary(query, s).then((r) => r.data), opts);
  const trend = useWidget<DashboardTrend>(key, (s) => dashboardApi.trend(query, s).then((r) => r.data), opts);
  const attention = useWidget<DashboardAttention>(key, (s) => dashboardApi.attention(query, s).then((r) => r.data), opts);
  // These three describe the workspace as it is now, so they do not depend on the date range.
  const [metaChecks, setMetaChecks] = useState(0);
  const workspaceOpts = { enabled, refreshKey: refreshKey + metaChecks };
  const business = useWidget<DashboardBusiness>('workspace', (s) => dashboardApi.business(s).then((r) => r.data), workspaceOpts);
  const whatsapp = useWidget<DashboardWhatsAppStatus>('workspace', (s) => dashboardApi.whatsappStatus(metaChecks > 0, s).then((r) => r.data), workspaceOpts);

  const reloadAll = () => { refresh(); };
  const anyLoading = summary.loading || trend.loading || attention.loading;
  const firstName = user?.name?.split(' ')[0] ?? '';

  if (!canView) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <EmptyNote title="The dashboard is for workspace owners and admins" href="/inbox" hrefLabel="Go to your inbox">
          Ask an admin if you need access to these numbers.
        </EmptyNote>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-gray-50">
    <div className="p-4 sm:p-6 max-w-[1280px] mx-auto space-y-5 sm:space-y-6">
      <Header
        firstName={firstName}
        meta={summary.data?.meta ?? null}
        range={range}
        loading={anyLoading}
        onPreset={(p) => setParams({ range: p === DEFAULT_PRESET ? null : p, from: null, to: null })}
        onCustom={(f, t) => setParams({ range: 'custom', from: f, to: t })}
        onRefresh={reloadAll}
      />

      {customProblem && (
        <p role="alert" className="text-sm text-red-700">{customProblem} Pick a different range to see your numbers.</p>
      )}

      {enabled && (
        <>
          {summary.data ? (
            <KpiCards data={summary.data} range={range} />
          ) : summary.error ? (
            <WidgetCard id="kpis" title="Key numbers" widget={summary}>{() => null}</WidgetCard>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading key numbers">
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36" />)}
            </div>
          )}

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-5">
              <WidgetCard
                id="attention"
                title={<span className="flex items-center gap-2.5"><span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-600"><AlertCircle size={18} /></span>Needs attention</span>}
                description="Things waiting on you right now"
                aside={<Link href="/inbox" className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-teal-700 hover:underline">View all<ArrowRight size={14} aria-hidden="true" /></Link>}
                widget={attention} skeletonClassName="h-32"
              >
                {(data) => <AlertTiles data={data} />}
              </WidgetCard>

              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <WidgetCard
                  id="trend" title="Conversation trend" widget={trend} skeletonClassName="h-80"
                  aside={
                    <div className="flex items-center gap-2">
                      {preset !== 'custom' && (
                        <SelectInput
                          label="Period" value={preset} className="w-28 py-1.5"
                          onChange={(v) => setParams({ range: v === DEFAULT_PRESET ? null : v, from: null, to: null })}
                          options={[{ value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]}
                        />
                      )}
                      <Button variant="secondary" size="sm" onClick={() => setShowTrendTable((v) => !v)} aria-pressed={showTrendTable}>
                        <Table2 size={14} aria-hidden="true" />{showTrendTable ? 'View chart' : 'View table'}
                      </Button>
                    </div>
                  }
                >
                  {(data) => <TrendCard data={data} showTable={showTrendTable} />}
                </WidgetCard>

                <WidgetCard
                  id="whatsapp" title="WhatsApp account status" widget={whatsapp}
                  description={<span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="text-sm font-bold text-blue-600">&infin;</span>As reported by Meta</span>}
                  aside={whatsapp.data && whatsappHeadline(whatsapp.data) ? <StatusBadge tone={whatsappHeadline(whatsapp.data)!.tone}>{whatsappHeadline(whatsapp.data)!.label}</StatusBadge> : undefined}
                >
                  {(data) => <WhatsAppCard data={data} refreshing={whatsapp.loading} onRefresh={() => setMetaChecks((n) => n + 1)} />}
                </WidgetCard>
              </div>
            </div>

            <WidgetCard id="business" title="Business and subscription" description="Your business details and plan" widget={business}>
              {(data) => <BusinessCard data={data} />}
            </WidgetCard>
          </div>
        </>
      )}
    </div>
    </div>
  );
}
