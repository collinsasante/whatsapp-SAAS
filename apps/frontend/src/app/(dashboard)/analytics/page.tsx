'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { analyticsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getPermissions } from '@/lib/permissions';
import { getApiError } from '@/lib/utils';
import { channelName, formatRange, toCsv } from '@/lib/analytics/format';
import { METRICS } from '@/lib/analytics/metrics';
import type { ChannelFilter, IntelligenceResponse, RangePreset } from '@/lib/analytics/types';
import { UserRole } from '@whatsapp-platform/shared-types';
import PageHeader from '@/components/ui/PageHeader';
import Toolbar, { customRangeProblem, PRESETS } from '@/components/analytics/Toolbar';
import KpiBand from '@/components/analytics/KpiBand';
import TrendPanel from '@/components/analytics/TrendPanel';
import { HealthSummary, InsightsPanel } from '@/components/analytics/InsightsPanel';
import CustomersSection from '@/components/analytics/CustomersSection';
import ConversationsSection from '@/components/analytics/ConversationsSection';
import TeamSection from '@/components/analytics/TeamSection';
import AiSection from '@/components/analytics/AiSection';
import TopicsSection from '@/components/analytics/TopicsSection';
import RevenueSection from '@/components/analytics/RevenueSection';
import { CampaignsPanel, HealthPanel } from '@/components/analytics/MessagingSection';
import AgentView from '@/components/analytics/AgentView';
import { ErrorState, Section, Skeleton } from '@/components/analytics/ui';

const CHANNELS: ChannelFilter[] = ['ALL', 'WHATSAPP', 'FACEBOOK_MESSENGER', 'INSTAGRAM'];
const PRESET_KEYS = [...PRESETS.map((p) => p.key), 'custom'] as RangePreset[];

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'next', label: 'What to do next' },
  { id: 'customers', label: 'Customers' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'team', label: 'Team' },
  { id: 'ai', label: 'Verz AI' },
  { id: 'topics', label: 'Topics' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'messaging', label: 'Campaigns' },
];

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar range for the agent view, whose endpoints take dates rather than a preset. */
function rangeForPreset(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  const to = isoDate(today);
  if (preset === 'custom') return { from: customFrom || to, to: customTo || to };
  const back = preset === 'today' ? 0 : preset === '7d' ? 6 : preset === '30d' ? 29 : 89;
  const from = new Date(today);
  from.setDate(from.getDate() - back);
  return { from: isoDate(from), to };
}

function buildCsv(data: IntelligenceResponse): string {
  const { current: c, previous: p, meta } = data;
  const secs = (v: number | null) => (v == null ? '' : v);
  const rows: Array<Array<string | number | null>> = [
    ['VerzChat analytics export'],
    ['Period', `${meta.from} to ${meta.to}`, 'Previous period', `${meta.previousFrom} to ${meta.previousTo}`],
    ['Channel', channelName(meta.channel), 'Timezone', meta.timezone],
    [],
    ['Metric', 'This period', 'Previous period', 'How it is calculated'],
    [METRICS.conversations.label, c.conversations.total, p.conversations.total, METRICS.conversations.calculation],
    [METRICS.newContacts.label, c.newContacts, p.newContacts, METRICS.newContacts.calculation],
    ['Median first reply (seconds)', secs(c.firstResponse.medianSeconds), secs(p.firstResponse.medianSeconds), METRICS.firstReply.calculation],
    ['Median time to resolve (seconds)', secs(c.resolution.medianSeconds), secs(p.resolution.medianSeconds), METRICS.resolution.calculation],
    [METRICS.resolved.label, c.resolved, p.resolved, METRICS.resolved.calculation],
    ['Reopened', c.reopened, p.reopened, 'Conversations reopened after being resolved'],
    [METRICS.leads.label, c.leads.created, p.leads.created, METRICS.leads.calculation],
    [METRICS.qualified.label, c.leads.qualified, p.leads.qualified, METRICS.qualified.calculation],
    [METRICS.aiEngaged.label, c.ai.engagedConversations, p.ai.engagedConversations, METRICS.aiEngaged.calculation],
    [METRICS.aiResolved.label, c.ai.resolvedWithoutPerson, p.ai.resolvedWithoutPerson, METRICS.aiResolved.calculation],
    ...c.orders.byCurrency.map((o) => [`Revenue from orders (${o.currency})`, o.revenue, p.orders.byCurrency.find((x) => x.currency === o.currency)?.revenue ?? 0, METRICS.revenue.calculation] as Array<string | number | null>),
    [],
    ['Date', 'Opened', 'Resolved', 'New contacts', 'Customer messages', 'Opened in previous period'],
    ...data.series.map((s) => [s.date, s.opened, s.resolved, s.newContacts, s.inbound, s.previousOpened]),
  ];
  return toCsv(rows);
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const router = useRouter();
  const pathname = usePathname() ?? '/analytics';
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const isAdmin = getPermissions(user?.role as UserRole | undefined).isAdmin;

  // The range and channel live in the address, so a view can be shared and the back button works.
  const rawRange = searchParams?.get('range') as RangePreset | null;
  const preset: RangePreset = rawRange && PRESET_KEYS.includes(rawRange) ? rawRange : '30d';
  const customFrom = searchParams?.get('from') ?? '';
  const customTo = searchParams?.get('to') ?? '';
  const rawChannel = searchParams?.get('channel') as ChannelFilter | null;
  const channel: ChannelFilter = rawChannel && CHANNELS.includes(rawChannel) ? rawChannel : 'ALL';
  const customValid = preset !== 'custom' || customRangeProblem(customFrom, customTo) === null;

  const setParams = useCallback((next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [k, v] of Object.entries(next)) { if (v == null || v === '') params.delete(k); else params.set(k, v); }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);

  const [data, setData] = useState<IntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!isAdmin || !customValid) return;
    const id = ++requestId.current;
    setLoading(true); setError(null);
    const params = preset === 'custom'
      ? { from: customFrom, to: customTo, preset: 'custom', channel }
      : { preset, channel };
    analyticsApi.intelligence(params)
      .then((res) => { if (id === requestId.current) setData(res.data as IntelligenceResponse); })
      .catch((err) => {
        if (id !== requestId.current) return;
        const message = getApiError(err, 'Please try again in a moment.');
        setError(message);
        toast.error(message);
      })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [isAdmin, preset, customFrom, customTo, channel, customValid, refreshKey]);

  const agentRange = useMemo(() => rangeForPreset(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const refresh = () => setRefreshKey((k) => k + 1);

  // A plain #anchor jump scrolls every scrollable ancestor, which slid the whole app (sidebar logo included) up
  // out of view. Scroll only this page's own container; the href stays as the fallback.
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const sectionNavRef = useRef<HTMLElement>(null);
  const jumpToSection = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const box = scrollBoxRef.current;
    const target = document.getElementById(id);
    if (!box || !target) return;
    event.preventDefault();
    const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - (sectionNavRef.current?.offsetHeight ?? 0) - 8;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: Math.max(top, 0), behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <div ref={scrollBoxRef} className="h-full overflow-auto overscroll-contain bg-gray-50" aria-busy={loading}>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 pt-5 pb-4">
        <div className="max-w-7xl mx-auto">
          <PageHeader
            title="Analytics"
            description={isAdmin
              ? 'How your business is doing, why, and what to do about it.'
              : 'How your own conversations are going. Workspace-wide analytics are visible to admins.'}
          />
          <div className="mt-4">
            <Toolbar
              preset={preset} customFrom={customFrom} customTo={customTo} channel={channel} showChannel={isAdmin}
              loading={loading}
              onPreset={(p) => setParams({ range: p === '30d' ? null : p, from: null, to: null })}
              onCustom={(from, to) => setParams({ range: 'custom', from, to })}
              onChannel={(c) => setParams({ channel: c === 'ALL' ? null : c })}
              onRefresh={refresh}
              onExport={isAdmin && data ? () => download(`verzchat-analytics-${data.meta.from}-to-${data.meta.to}.csv`, buildCsv(data)) : undefined}
            />
          </div>
          {isAdmin && data && (
            <p className="text-xs text-gray-500 mt-3">
              {formatRange(data.meta.from, data.meta.to)} compared with {formatRange(data.meta.previousFrom, data.meta.previousTo)}
              {' · '}{channelName(data.meta.channel)}{' · '}{data.meta.timezone}
              {loading && <span role="status" className="ml-2 text-teal-700">Updating</span>}
            </p>
          )}
        </div>
      </header>

      {isAdmin && (
        <nav ref={sectionNavRef} aria-label="Sections of this page" className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200">
          <ul className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <li key={n.id}>
                <a href={`#${n.id}`} onClick={(e) => jumpToSection(e, n.id)} className="block px-3 py-2.5 text-sm text-gray-600 hover:text-teal-700 whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 rounded">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-10">
        {!customValid ? (
          <p role="alert" className="text-sm text-red-700">Choose a valid custom date range to see analytics.</p>
        ) : !isAdmin ? (
          <AgentView from={agentRange.from} to={agentRange.to} refreshKey={refreshKey} />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : !data ? (
          <div className="space-y-6"><Skeleton className="h-52" /><Skeleton className="h-80" /><Skeleton className="h-64" /></div>
        ) : (
          <div className={loading ? 'opacity-60 transition-opacity space-y-10' : 'space-y-10'}>
            <Section id="overview" question="What is happening in your business?" description="The numbers that matter most, set against the previous period.">
              <div className="space-y-4">
                <KpiBand data={data} />
                <TrendPanel data={data} />
              </div>
            </Section>

            <Section id="next" question="What should you do next?" description="Prioritised from the numbers below. Each item shows the evidence it is based on.">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3"><InsightsPanel insights={data.insights} /></div>
                <div className="lg:col-span-2 self-start lg:sticky lg:top-14"><HealthSummary areas={data.health} /></div>
              </div>
            </Section>

            <Section id="customers" question="Who is reaching you, and where from?" description="Customer sources, channels and the lead pipeline.">
              <CustomersSection data={data} />
            </Section>

            <Section id="conversations" question="How well are conversations handled?" description="Who is waiting, how quickly customers get answers, and when the busy times are.">
              <ConversationsSection data={data} />
            </Section>

            <Section id="team" question="How is the team doing?" description="Workload and speed for each person on the team.">
              <TeamSection data={data} />
            </Section>

            <Section id="ai" question="How is Verz AI helping?" description="What Verz AI handled on its own, and what it passed to a person.">
              <AiSection data={data} />
            </Section>

            <Section id="topics" question="What are customers asking about?">
              <TopicsSection data={data} />
            </Section>

            <Section id="revenue" question="Is it turning into business?" description="Only what VerzChat can actually measure from orders and leads.">
              <RevenueSection data={data} />
            </Section>
          </div>
        )}

        {isAdmin && customValid && (
          <Section id="messaging" question="Campaigns and WhatsApp numbers" description="Template campaign results and the quality of your WhatsApp numbers. These are specific to WhatsApp and ignore the channel filter.">
            <div className="space-y-4">
              <CampaignsPanel from={data?.meta.from ?? agentRange.from} to={data?.meta.to ?? agentRange.to} />
              <HealthPanel />
            </div>
          </Section>
        )}

        {isAdmin && data && (
          <p className="text-xs text-gray-500 border-t border-gray-200 pt-4 max-w-3xl">
            Every figure is counted from your workspace records for the dates shown, in {data.meta.timezone}. Evaluation and test conversations are excluded.
            "n/a" means the figure cannot be calculated, which is different from zero. Revenue is never estimated.
          </p>
        )}
      </main>
    </div>
  );
}
