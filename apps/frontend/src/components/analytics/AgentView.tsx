'use client';
import { useCallback, useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analyticsApi } from '@/lib/api';
import { formatDay, formatDuration, formatNumber } from '@/lib/analytics/format';
import { getApiError } from '@/lib/utils';
import { DeltaView, EmptyNote, ErrorState, Panel, Section, Skeleton } from './ui';
import { compare } from '@/lib/analytics/format';

/**
 * What an agent or viewer sees: only their own conversations, from the endpoints that are already scoped to the
 * requester on the server. Workspace-wide measures (revenue, other agents, AI, leads, the whole-team heatmap) are
 * deliberately absent, and the server would refuse them anyway.
 */

interface Overview {
  from: string; to: string;
  conversations: { total: number; changePct: number | null };
  resolved: { count: number; changePct: number | null };
  openWorkload: { count: number };
  medianFirstResponseSeconds: number | null;
  csat: { average: number | null; responses: number };
}
interface Conversations {
  series: Array<{ date: string; opened?: number; resolved?: number }>;
  byTag: Array<{ tag: string; count: number }>;
}

function Stat({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="bg-white p-4">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{value}</dd>
      <dd className="text-xs text-gray-500 mt-1 min-h-[1rem]">{detail}</dd>
    </div>
  );
}

function changeDelta(pct: number | null, direction: 'higher-is-better' | 'neutral') {
  if (pct == null) return compare(null, null, direction);
  return compare(100 + pct, 100, direction);
}

export default function AgentView({ from, to, refreshKey }: { from: string; to: string; refreshKey: number }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [conversations, setConversations] = useState<Conversations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [o, c] = await Promise.all([analyticsApi.overview(from, to), analyticsApi.conversations(from, to, 'day')]);
      setOverview(o.data as Overview);
      setConversations(c.data as Conversations);
    } catch (err) {
      setError(getApiError(err, 'Please try again in a moment.'));
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (loading && !overview) return <Skeleton className="h-64" />;
  if (!overview || !conversations) return null;

  const points = conversations.series.map((s) => ({ label: formatDay(s.date.slice(0, 10)), opened: s.opened ?? 0, resolved: s.resolved ?? 0 }));
  const hasData = points.some((p) => p.opened > 0 || p.resolved > 0);

  return (
    <div className="space-y-8">
      <Section id="your-numbers" question="How your conversations are going" description="These figures cover only the conversations assigned to you.">
        <Panel className="overflow-hidden">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200">
            <Stat label="Conversations" value={formatNumber(overview.conversations.total)} detail={<DeltaView delta={changeDelta(overview.conversations.changePct, 'neutral')} />} />
            <Stat label="Resolved" value={formatNumber(overview.resolved.count)} detail={<DeltaView delta={changeDelta(overview.resolved.changePct, 'higher-is-better')} />} />
            <Stat label="Open now" value={formatNumber(overview.openWorkload.count)} detail="Not resolved today" />
            <Stat
              label="Median first reply" value={overview.medianFirstResponseSeconds != null ? formatDuration(overview.medianFirstResponseSeconds) : 'n/a'}
              detail={overview.csat.average != null ? `Satisfaction ${overview.csat.average} / 5 from ${overview.csat.responses} ratings` : 'No ratings yet'}
            />
          </dl>
        </Panel>
      </Section>

      <Section id="your-trend" question="Opened and resolved over time">
        <Panel className="p-5">
          {!hasData ? <EmptyNote title="No conversations in this period" /> : (
            <div className="h-64" role="img" aria-label="Conversations opened and resolved each day">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} minTickGap={28} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e5e7eb' }} />
                  <Line type="linear" dataKey="opened" name="Opened" stroke="#0d9488" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="resolved" name="Resolved" stroke="#334155" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </Section>
    </div>
  );
}
