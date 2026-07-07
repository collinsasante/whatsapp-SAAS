'use client';
import { useEffect, useState, useCallback, Fragment } from 'react';
import {
  Users, MessageSquare, Send, TrendingUp, TrendingDown, Minus,
  BarChart3, RefreshCw, Clock, DollarSign, AlertCircle, ShieldAlert,
  CheckCircle2, XCircle,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { analyticsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { getPermissions } from '@/lib/permissions';
import { UserRole } from '@whatsapp-platform/shared-types';
import { cn, getApiError } from '@/lib/utils';
import toast from 'react-hot-toast';

// ─── Types (mirroring apps/backend/src/analytics response shapes) ────────────

interface OverviewResponse {
  from: string; to: string; scope: 'tenant' | 'agent';
  conversations: { total: number; new: number; returning: number; changePct: number | null };
  messages: { sent: number; delivered: number; read: number; replied: number; deliveryRate: number; readRate: number; replyRate: number };
  medianFirstResponseSeconds: number | null;
  revenue: { amount: number; currency: string; successCount: number; failedCount: number } | null;
}

interface ConversationsResponse {
  from: string; to: string; granularity: 'day' | 'hour'; scope: 'tenant' | 'agent';
  series: Array<{ date: string; new: number; returning: number; opened: number; resolved: number } | { date: string; opened: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byTag: Array<{ tag: string; count: number }>;
  busiestHours: Array<{ dayOfWeek: number; hour: number; count: number }>;
}

interface AgentRow {
  agentId: string; name: string; avatarUrl: string | null;
  conversationsHandled: number; resolvedCount: number;
  medianFirstResponseSeconds: number | null; medianResolutionSeconds: number | null;
}
interface AgentsResponse {
  from: string; to: string; agents: AgentRow[];
  teamAverage: { conversationsHandled: number; resolvedCount: number; medianFirstResponseSeconds: number | null; medianResolutionSeconds: number | null };
}

interface CampaignRow {
  id: string; name: string; status: string; templateName: string;
  totalRecipients: number; sentCount: number; deliveredCount: number; readCount: number;
  repliedCount: number; failedCount: number; clickCount: number;
  failureBreakdown: Array<{ category: string; label: string; count: number }>;
}
interface TemplatePerf {
  templateId: string; name: string; approvalStatus: string; sentCount: number; deliveryRate: number; readRate: number;
}
interface CampaignsResponse {
  from: string; to: string; campaigns: CampaignRow[]; templatePerformance: TemplatePerf[];
  meta: { total: number; limit: number; offset: number };
}

interface HealthResponse {
  numbers: Array<{ id: string; label: string; phoneNumberId: string; qualityRating: string | null; messagingLimitTier: string | null; qualitySyncedAt: string | null }>;
  numbersConfigured: boolean;
  optOuts: { last7Days: number; previous7Days: number; spike: boolean; blocked: number; optedOut: number };
}

interface RevenueResponse {
  from: string; to: string; note: string;
  byGateway: Array<{ gateway: string; successCount: number; failedCount: number; amount: number }>;
  totalAmount: number; totalSuccessCount: number; totalFailedCount: number;
}

// ─── Date range helpers ───────────────────────────────────────────────────────

type Preset = 'today' | '7d' | '30d' | '90d' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'custom', label: 'Custom' },
];

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeForPreset(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  const to = fmtDate(today);
  if (preset === 'custom') return { from: customFrom || to, to: customTo || to };
  const daysBack = preset === 'today' ? 0 : preset === '7d' ? 6 : preset === '30d' ? 29 : 89;
  const from = new Date(today);
  from.setDate(from.getDate() - daysBack);
  return { from: fmtDate(from), to };
}

function formatSeconds(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Small shared bits ─────────────────────────────────────────────────────────

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-gray-400 flex items-center gap-0.5"><Minus size={11} />—</span>;
  if (pct === 0) return <span className="text-xs text-gray-400 flex items-center gap-0.5"><Minus size={11} />0%</span>;
  const up = pct > 0;
  return (
    <span className={cn('text-xs font-semibold flex items-center gap-0.5', up ? 'text-teal-600' : 'text-red-500')}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(pct)}%
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, iconColor }: {
  icon: React.ElementType; label: string; value: string; sub?: React.ReactNode; iconColor?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', iconColor ?? 'bg-teal-50 text-teal-600')}>
          <Icon size={16} />
        </div>
        {sub}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
      <BarChart3 size={28} className="text-gray-300" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
      <AlertCircle size={28} className="text-red-300" />
      <p className="text-sm">Failed to load this data.</p>
      <button onClick={onRetry} className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700">Retry</button>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-gray-100 rounded-xl animate-pulse', className)} />;
}

// ─── Overview cards ────────────────────────────────────────────────────────────

function OverviewCards({ data }: { data: OverviewResponse }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard icon={Users} label="Conversations" value={data.conversations.total.toLocaleString()}
        sub={<ChangeBadge pct={data.conversations.changePct} />} />
      <StatCard icon={Send} label="Messages Sent" value={data.messages.sent.toLocaleString()}
        sub={<span className="text-xs text-gray-400">{data.messages.deliveryRate}% delivered</span>} iconColor="bg-blue-50 text-blue-600" />
      <StatCard icon={MessageSquare} label="Replied (inbound)" value={data.messages.replied.toLocaleString()}
        sub={<span className="text-xs text-gray-400">{data.messages.replyRate}% reply rate</span>} iconColor="bg-purple-50 text-purple-600" />
      <StatCard icon={Clock} label="Median First Response" value={formatSeconds(data.medianFirstResponseSeconds)} iconColor="bg-amber-50 text-amber-600" />
      {data.revenue && (
        <StatCard icon={DollarSign} label="Revenue Collected" value={`$${data.revenue.amount.toLocaleString()}`}
          sub={<span className="text-xs text-gray-400">{data.revenue.successCount} payments</span>} iconColor="bg-emerald-50 text-emerald-600" />
      )}
    </div>
  );
}

// ─── Conversations tab ─────────────────────────────────────────────────────────

function ConversationsTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<ConversationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [granularity, setGranularity] = useState<'day' | 'hour'>('day');

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await analyticsApi.conversations(from, to, granularity);
      setData(res.data as ConversationsResponse);
    } catch { setError(true); } finally { setLoading(false); }
  }, [from, to, granularity]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-96" />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!data) return null;

  const maxHeat = Math.max(1, ...data.busiestHours.map((h) => h.count));

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 text-sm">Conversation Volume</h3>
          {data.granularity === 'hour' && <span className="text-xs text-gray-400">Hourly (range ≤ 3 days)</span>}
        </div>
        {data.series.length === 0 ? <EmptyState message="No conversation activity in this period" /> : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.series}>
              <defs>
                <linearGradient id="openedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                tickFormatter={(v: string) => granularity === 'hour' ? new Date(v).toLocaleTimeString([], { hour: '2-digit' }) : v.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid #e5e7eb' }} />
              <Area type="monotone" dataKey="opened" name="Opened" stroke="#0d9488" fill="url(#openedGrad)" strokeWidth={2} />
              {'resolved' in (data.series[0] ?? {}) && (
                <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#7c3aed" fillOpacity={0} strokeWidth={2} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
        <div className="flex justify-end mt-2">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {(['day', 'hour'] as const).map((g) => (
              <button key={g} onClick={() => setGranularity(g)}
                className={cn('px-2.5 py-1 text-xs rounded-md font-medium transition-colors', granularity === g ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500')}>
                {g === 'day' ? 'Daily' : 'Hourly'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 text-sm mb-4">By Status</h3>
          {data.byStatus.length === 0 ? <EmptyState message="No data" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.byStatus} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="status" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={80} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid #e5e7eb' }} />
                <Bar dataKey="count" fill="#0d9488" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 text-sm mb-4">Top Tags</h3>
          {data.byTag.length === 0 ? <EmptyState message="No tagged conversations yet" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.byTag} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="tag" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={80} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid #e5e7eb' }} />
                <Bar dataKey="count" fill="#6366f1" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 overflow-x-auto">
        <h3 className="font-semibold text-gray-900 text-sm mb-4">Busiest Hours</h3>
        {data.busiestHours.length === 0 ? <EmptyState message="Not enough data yet" /> : (
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-0.5">
              <div />
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="text-[9px] text-gray-400 text-center">{h}</div>
              ))}
              {DOW_LABELS.map((label, dow) => (
                <Fragment key={dow}>
                  <div className="text-[10px] text-gray-500 flex items-center">{label}</div>
                  {Array.from({ length: 24 }).map((_, hour) => {
                    const cell = data.busiestHours.find((h) => h.dayOfWeek === dow && h.hour === hour);
                    const intensity = cell ? cell.count / maxHeat : 0;
                    return (
                      <div key={`${dow}-${hour}`} title={`${label} ${hour}:00 — ${cell?.count ?? 0} messages`}
                        className="aspect-square rounded-sm"
                        style={{ backgroundColor: intensity > 0 ? `rgba(13,148,136,${0.15 + intensity * 0.85})` : '#f3f4f6' }} />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Agents tab (admin only) ────────────────────────────────────────────────────

type AgentSortKey = keyof Omit<AgentRow, 'agentId' | 'name' | 'avatarUrl'>;

function AgentsTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortKey, setSortKey] = useState<AgentSortKey>('conversationsHandled');

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await analyticsApi.agents(from, to);
      setData(res.data as AgentsResponse);
    } catch { setError(true); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-72" />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!data) return null;
  if (data.agents.length === 0) return <EmptyState message="No agents with activity in this period" />;

  const sorted = [...data.agents].sort((a, b) => {
    const av = a[sortKey] ?? -1, bv = b[sortKey] ?? -1;
    return (bv ?? 0) - (av ?? 0);
  });

  const columns: { key: AgentSortKey; label: string; format?: (v: number | null) => string }[] = [
    { key: 'conversationsHandled', label: 'Handled' },
    { key: 'resolvedCount', label: 'Resolved' },
    { key: 'medianFirstResponseSeconds', label: 'Median First Response', format: formatSeconds },
    { key: 'medianResolutionSeconds', label: 'Median Resolution', format: formatSeconds },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500">Agent</th>
              {columns.map((c) => (
                <th key={c.key} className="text-left px-4 py-3 font-medium text-gray-500 cursor-pointer select-none" onClick={() => setSortKey(c.key)}>
                  {c.label}{sortKey === c.key && ' ▾'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map((a) => (
              <tr key={a.agentId} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3 text-gray-600">{c.format ? c.format(a[c.key]) : (a[c.key] ?? '—')}</td>
                ))}
              </tr>
            ))}
            <tr className="bg-teal-50/50 font-semibold">
              <td className="px-4 py-3 text-teal-700">Team Average</td>
              <td className="px-4 py-3 text-teal-700">{data.teamAverage.conversationsHandled}</td>
              <td className="px-4 py-3 text-teal-700">{data.teamAverage.resolvedCount}</td>
              <td className="px-4 py-3 text-teal-700">{formatSeconds(data.teamAverage.medianFirstResponseSeconds)}</td>
              <td className="px-4 py-3 text-teal-700">{formatSeconds(data.teamAverage.medianResolutionSeconds)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Campaigns tab ──────────────────────────────────────────────────────────────

function CampaignFunnel({ campaign }: { campaign: CampaignRow }) {
  const steps = [
    { label: 'Sent', value: campaign.sentCount, color: 'bg-blue-400' },
    { label: 'Delivered', value: campaign.deliveredCount, color: 'bg-teal-400' },
    { label: 'Read', value: campaign.readCount, color: 'bg-purple-400' },
    { label: 'Replied', value: campaign.repliedCount, color: 'bg-green-400' },
    { label: 'Clicked', value: campaign.clickCount, color: 'bg-indigo-400' },
  ];
  const total = campaign.totalRecipients || 1;
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-900 text-sm">{campaign.name}</p>
          <p className="text-xs text-gray-400">{campaign.templateName} · {campaign.status}</p>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {steps.map((s) => (
          <div key={s.label} className="text-center">
            <div className="relative h-14 bg-gray-100 rounded-lg overflow-hidden flex items-end mb-1">
              <div className={cn('w-full', s.color)} style={{ height: `${Math.max(2, Math.round((s.value / total) * 100))}%` }} />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-800">{s.value}</span>
            </div>
            <p className="text-[10px] text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>
      {campaign.failureBreakdown.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {campaign.failureBreakdown.map((f) => (
            <span key={f.category} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">
              {f.label}: {f.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignsTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<CampaignsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await analyticsApi.campaigns(from, to);
      setData(res.data as CampaignsResponse);
    } catch { setError(true); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-96" />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 text-sm mb-4">Campaign Funnels ({data.meta.total})</h3>
        {data.campaigns.length === 0 ? <EmptyState message="No campaigns sent in this period" /> : (
          <div className="space-y-3">
            {data.campaigns.map((c) => <CampaignFunnel key={c.id} campaign={c} />)}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <h3 className="font-semibold text-gray-900 text-sm px-5 pt-5 mb-2">Template Performance</h3>
        {data.templatePerformance.length === 0 ? <div className="px-5 pb-5"><EmptyState message="No templates used yet" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Template</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Approval</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Sent</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Delivery Rate</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Read Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.templatePerformance.map((t) => (
                  <tr key={t.templateId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                        t.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : t.approvalStatus === 'REJECTED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700')}>
                        {t.approvalStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{t.sentCount}</td>
                    <td className="px-4 py-3 text-gray-600">{t.deliveryRate}%</td>
                    <td className="px-4 py-3 text-gray-600">{t.readRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Health tab ─────────────────────────────────────────────────────────────────

const QUALITY_STYLE: Record<string, string> = {
  GREEN: 'bg-emerald-100 text-emerald-700', YELLOW: 'bg-amber-100 text-amber-700', RED: 'bg-red-100 text-red-600',
};

function HealthTab() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await analyticsApi.health();
      setData(res.data as HealthResponse);
    } catch { setError(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-72" />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 text-sm mb-4">WhatsApp Number Quality</h3>
        {!data.numbersConfigured ? <EmptyState message="No WhatsApp numbers configured yet" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.numbers.map((n) => (
              <div key={n.id} className="border border-gray-100 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{n.label}</p>
                  <p className="text-xs text-gray-400">{n.messagingLimitTier ?? 'Tier unknown'}</p>
                </div>
                <span className={cn('text-xs px-2.5 py-1 rounded-full font-semibold', QUALITY_STYLE[n.qualityRating ?? ''] ?? 'bg-gray-100 text-gray-500')}>
                  {n.qualityRating ?? 'Unknown'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 text-sm">Opt-outs &amp; Blocks (last 7 days)</h3>
          {data.optOuts.spike && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-600 font-semibold flex items-center gap-1">
              <ShieldAlert size={12} /> Spike detected
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-2xl font-bold text-gray-900">{data.optOuts.last7Days}</p>
            <p className="text-xs text-gray-400">Last 7 days ({data.optOuts.blocked} blocked, {data.optOuts.optedOut} opted out)</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-400">{data.optOuts.previous7Days}</p>
            <p className="text-xs text-gray-400">Previous 7 days</p>
          </div>
        </div>
        {data.optOuts.spike && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            Opt-outs/blocks more than doubled compared to the previous week — worth checking recent campaigns or message frequency.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Revenue tab (admin only) ───────────────────────────────────────────────────

function RevenueTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<RevenueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await analyticsApi.revenue(from, to);
      setData(res.data as RevenueResponse);
    } catch { setError(true); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-64" />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{data.note}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={DollarSign} label="Total Revenue" value={`$${data.totalAmount.toLocaleString()}`} iconColor="bg-emerald-50 text-emerald-600" />
        <StatCard icon={CheckCircle2} label="Successful Payments" value={String(data.totalSuccessCount)} iconColor="bg-teal-50 text-teal-600" />
        <StatCard icon={XCircle} label="Failed Payments" value={String(data.totalFailedCount)} iconColor="bg-red-50 text-red-600" />
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <h3 className="font-semibold text-gray-900 text-sm px-5 pt-5 mb-2">By Gateway</h3>
        {data.byGateway.length === 0 ? <div className="px-5 pb-5"><EmptyState message="No payments in this period" /></div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Gateway</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Successful</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Failed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.byGateway.map((g) => (
                <tr key={g.gateway} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{g.gateway}</td>
                  <td className="px-4 py-3 text-gray-600">${g.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{g.successCount}</td>
                  <td className="px-4 py-3 text-gray-600">{g.failedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'conversations' | 'campaigns' | 'agents' | 'health' | 'revenue';

export default function AnalyticsPage() {
  const { user } = useAuthStore();
  const perms = getPermissions(user?.role as UserRole | undefined);

  const [preset, setPreset] = useState<Preset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [tab, setTab] = useState<Tab>('conversations');

  const { from, to } = rangeForPreset(preset, customFrom, customTo);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState(false);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true); setOverviewError(false);
    try {
      const res = await analyticsApi.overview(from, to);
      setOverview(res.data as OverviewResponse);
    } catch (err) {
      setOverviewError(true);
      toast.error(getApiError(err, 'Failed to load analytics overview'));
    } finally { setOverviewLoading(false); }
  }, [from, to]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const tabs: { key: Tab; label: string; adminOnly?: boolean }[] = [
    { key: 'conversations', label: 'Conversations' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'agents', label: 'Agents', adminOnly: true },
    { key: 'health', label: 'WhatsApp Health' },
    { key: 'revenue', label: 'Revenue', adminOnly: true },
  ].filter((t) => !t.adminOnly || perms.isAdmin) as { key: Tab; label: string; adminOnly?: boolean }[];

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
            <p className="text-sm text-gray-500">{overview?.scope === 'agent' ? 'Your performance' : 'Business performance'} overview</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => setPreset(p.key)}
                  className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors', preset === p.key ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={() => void loadOverview()} className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 mt-3">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5" />
            <span className="text-gray-400 text-sm">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5" />
          </div>
        )}
      </div>

      <div className="p-6 space-y-6">
        {overviewLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : overviewError ? (
          <ErrorState onRetry={() => void loadOverview()} />
        ) : overview ? (
          <OverviewCards data={overview} />
        ) : null}

        <div className="border-b border-gray-200 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                tab === t.key ? 'border-teal-600 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {t.label}
            </button>
          ))}
        </div>

        <div>
          {tab === 'conversations' && <ConversationsTab from={from} to={to} />}
          {tab === 'campaigns' && <CampaignsTab from={from} to={to} />}
          {tab === 'agents' && perms.isAdmin && <AgentsTab from={from} to={to} />}
          {tab === 'health' && <HealthTab />}
          {tab === 'revenue' && perms.isAdmin && <RevenueTab from={from} to={to} />}
        </div>
      </div>
    </div>
  );
}
