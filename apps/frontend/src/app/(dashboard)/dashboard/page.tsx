'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Users, MessageSquare, CheckCircle, RefreshCw,
  Wifi, WifiOff, Shield, TrendingUp, TrendingDown,
  CalendarDays, Plus, ArrowUp, ArrowDown, Clock,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { dashboardApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Overview {
  contacts: { total: number; open: number; assigned: number; unassigned: number };
  conversations: { total: number; open: number; pending: number; resolved: number };
  messages: number;
  campaigns: number;
  business: {
    name: string; phone: string; email: string; address: string;
    website: string; description: string; wabaId: string | null;
    phoneNumberId: string | null; plan: string;
  };
}

interface TeamMember {
  id: string; name: string; email: string; avatarUrl: string | null;
  assignedConversations: number; activeConversations: number;
  resolvedToday: number; isOnline: boolean;
}

interface WaStatus {
  isConfigured: boolean; isConnected: boolean; phoneNumberId: string | null;
  qualityRating: string; messagingLimit: string; verificationStatus: string;
}

interface MetaBusinessProfile {
  phone: {
    verified_name?: string;
    display_phone_number?: string;
    quality_rating?: string;
    messaging_limit_tier?: string;
    code_verification_status?: string;
  };
  profile: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    profile_picture_url?: string;
    websites?: string[];
    vertical?: string;
  };
}

interface ConvStats { opened: number; closed: number }
interface TrendPoint { date: string; opened: number; closed: number }

type DatePreset = 'today' | '7d' | '30d' | 'custom';

function todayISO() { return new Date().toISOString().split('T')[0]!; }
function daysAgoISO(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0]!;
}
function qualityColor(rating: string) {
  if (rating === 'GREEN') return 'text-green-600';
  if (rating === 'YELLOW') return 'text-yellow-600';
  return 'text-red-600';
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DATE_PRESETS: { key: DatePreset; label: string; from: () => string; to: () => string }[] = [
  { key: 'today', label: 'Today', from: todayISO, to: todayISO },
  { key: '7d',    label: '7 Days', from: () => daysAgoISO(7), to: todayISO },
  { key: '30d',   label: '30 Days', from: () => daysAgoISO(30), to: todayISO },
];

function Section({ title, icon: Icon, children, className }: {
  title: string; icon: React.ElementType; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('bg-white border border-gray-200 rounded-2xl p-5', className)}>
      <div className="flex items-center gap-2 mb-4">
        <Icon size={15} className="text-teal-600" />
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className={cn('text-xs font-medium text-gray-800 text-right truncate max-w-48', mono && 'font-mono')}>
        {value || <span className="text-gray-400 italic">Not set</span>}
      </span>
    </div>
  );
}

function KpiCard({ label, value, sub, icon: Icon, trend, trendLabel, color = 'teal', urgent }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; trend?: number; trendLabel?: string;
  color?: 'teal' | 'blue' | 'green' | 'purple' | 'orange';
  urgent?: boolean;
}) {
  const colorMap = {
    teal:   { bg: 'bg-teal-50',   icon: 'text-teal-600',   ring: 'bg-teal-100' },
    blue:   { bg: 'bg-blue-50',   icon: 'text-blue-600',   ring: 'bg-blue-100' },
    green:  { bg: 'bg-green-50',  icon: 'text-green-600',  ring: 'bg-green-100' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600', ring: 'bg-purple-100' },
    orange: { bg: 'bg-orange-50', icon: 'text-orange-600', ring: 'bg-orange-100' },
  };
  const c = colorMap[color];
  return (
    <div className={cn('bg-white border rounded-2xl p-5 flex items-start gap-4 transition-colors', urgent ? 'border-orange-200 bg-orange-50/30' : 'border-gray-200')}>
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', c.ring)}>
        <Icon size={18} className={c.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className={cn('text-2xl font-bold mt-0.5', urgent && typeof value === 'number' && value > 0 ? 'text-orange-600' : 'text-gray-900')}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        {trend !== undefined && (
          <div className={cn('flex items-center gap-0.5 text-xs font-medium mt-1', trend >= 0 ? 'text-green-600' : 'text-red-500')}>
            {trend >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
            {Math.abs(trend)}% {trendLabel}
          </div>
        )}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-gray-500 capitalize">{p.name}:</span>
          <span className="font-semibold text-gray-800">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function DashboardPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [waStatus, setWaStatus] = useState<WaStatus | null>(null);
  const [convStats, setConvStats] = useState<ConvStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [metaBiz, setMetaBiz] = useState<MetaBusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preset, setPreset] = useState<DatePreset>('30d');
  const [dateFrom, setDateFrom] = useState(daysAgoISO(30));
  const [dateTo, setDateTo] = useState(todayISO());
  const [statsLoading, setStatsLoading] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [ovRes, teamRes, waRes, trendRes, bizRes] = await Promise.allSettled([
        dashboardApi.overview(),
        dashboardApi.teamStats(),
        dashboardApi.whatsappStatus(),
        dashboardApi.conversationTrend(30),
        dashboardApi.businessProfile(),
      ]);
      if (ovRes.status === 'fulfilled') setOverview(ovRes.value.data as Overview);
      if (teamRes.status === 'fulfilled') setTeam(teamRes.value.data as TeamMember[]);
      if (waRes.status === 'fulfilled') setWaStatus(waRes.value.data as WaStatus);
      if (trendRes.status === 'fulfilled') setTrend((trendRes.value.data as TrendPoint[]) ?? []);
      if (bizRes.status === 'fulfilled' && bizRes.value.data) setMetaBiz(bizRes.value.data as MetaBusinessProfile);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  const loadStats = useCallback(async (from: string, to: string) => {
    setStatsLoading(true);
    try {
      const res = await dashboardApi.conversationStats(from, to);
      setConvStats(res.data as ConvStats);
    } finally { setStatsLoading(false); }
  }, []);

  const applyPreset = useCallback((p: DatePreset) => {
    const found = DATE_PRESETS.find((d) => d.key === p);
    if (found) {
      const from = found.from();
      const to = found.to();
      setDateFrom(from);
      setDateTo(to);
      setPreset(p);
      void loadStats(from, to);
    } else {
      setPreset('custom');
    }
  }, [loadStats]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadStats(dateFrom, dateTo); }, [loadStats, dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  const biz = overview?.business;
  const contacts = overview?.contacts;
  const conv = overview?.conversations;
  const trendData = trend.map((p) => ({ ...p, date: fmtDate(p.date) }));
  const pendingChats = conv?.pending ?? 0;

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-6 max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
          <button
            onClick={() => { void load(true); }}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-gray-600"
          >
            <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {/* No channel banner */}
        {waStatus && !waStatus.isConnected && (
          <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">No channel connected</p>
                <p className="text-xs text-gray-600 mt-0.5">Connect WhatsApp Business API to start receiving conversations</p>
              </div>
            </div>
            <button onClick={() => router.push('/channels')}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-xl transition-colors">
              <Plus size={14} />Add Channel
            </button>
          </div>
        )}

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Contacts"     value={contacts?.total ?? 0}    icon={Users}         color="teal"   />
          <KpiCard label="Open Conversations" value={conv?.open ?? 0}         icon={MessageSquare} color="blue"   />
          <KpiCard label="Resolved Today"     value={team.reduce((a, m) => a + m.resolvedToday, 0)} icon={CheckCircle} color="green" />
          <KpiCard
            label="Pending Chats"
            value={pendingChats}
            sub="Requesting support"
            icon={Clock}
            color="orange"
            urgent={pendingChats > 0}
          />
        </div>

        {/* Conversation Stats with Date Filter */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-teal-600" />
              <h2 className="text-sm font-semibold text-gray-900">Conversation Activity</h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Quick preset buttons */}
              <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => applyPreset(p.key)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                      preset === p.key ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Custom date range */}
              <div className="flex items-center gap-1.5">
                <CalendarDays size={13} className="text-gray-400" />
                <input type="date" value={dateFrom} max={dateTo}
                  onChange={e => { setDateFrom(e.target.value); setPreset('custom'); void loadStats(e.target.value, dateTo); }}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <span className="text-xs text-gray-400">—</span>
                <input type="date" value={dateTo} min={dateFrom} max={todayISO()}
                  onChange={e => { setDateTo(e.target.value); setPreset('custom'); void loadStats(dateFrom, e.target.value); }}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Opened', val: convStats?.opened ?? 0, icon: TrendingUp, color: 'text-teal-600', bg: 'bg-teal-50 border-teal-100' },
              { label: 'Resolved', val: convStats?.closed ?? 0, icon: TrendingDown, color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
            ].map(({ label, val, icon: Icon, color, bg }) => (
              <div key={label} className={cn('border rounded-2xl p-5 text-center', bg)}>
                <Icon size={18} className={cn('mx-auto mb-2', color)} />
                {statsLoading
                  ? <div className="animate-pulse h-9 bg-gray-200 rounded w-14 mx-auto" />
                  : <p className="text-3xl font-bold text-gray-900">{val.toLocaleString()}</p>
                }
                <p className="text-xs text-gray-500 mt-1 font-medium">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Conversation Trend Chart */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={15} className="text-teal-600" />
            <h2 className="text-sm font-semibold text-gray-900">30-Day Trend</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Last 30 days</span>
          </div>
          {trendData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
              No conversation data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#0d9488" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradClosed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Area type="monotone" dataKey="opened" name="Opened" stroke="#0d9488" strokeWidth={2} fill="url(#gradOpened)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                <Area type="monotone" dataKey="closed" name="Resolved" stroke="#22c55e" strokeWidth={2} fill="url(#gradClosed)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Row: WA Status + Team */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* WhatsApp Status */}
          <Section title="WhatsApp Business API" icon={waStatus?.isConnected ? Wifi : WifiOff}>
            <div className="space-y-3">
              {[
                { label: 'Connection', value: waStatus?.isConnected ? 'Connected' : 'Disconnected', dot: waStatus?.isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500', vcolor: waStatus?.isConnected ? 'text-green-600' : 'text-red-600' },
                { label: 'Quality Rating', value: waStatus?.qualityRating ?? '—', dot: waStatus?.qualityRating === 'GREEN' ? 'bg-green-500' : waStatus?.qualityRating === 'YELLOW' ? 'bg-yellow-500' : 'bg-red-400', vcolor: qualityColor(waStatus?.qualityRating ?? '') },
                { label: 'Verification', value: waStatus?.verificationStatus ?? '—', dot: waStatus?.verificationStatus === 'VERIFIED' ? 'bg-green-500' : 'bg-yellow-400', vcolor: waStatus?.verificationStatus === 'VERIFIED' ? 'text-green-600' : 'text-yellow-600' },
                { label: 'Messaging Limit', value: waStatus?.messagingLimit ?? '—', dot: 'bg-teal-400', vcolor: 'text-gray-800' },
              ].map(({ label, value, dot, vcolor }) => (
                <div key={label} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className={cn('w-2 h-2 rounded-full flex-shrink-0', dot)} />
                    <span className="text-xs text-gray-700 font-medium">{label}</span>
                  </div>
                  <span className={cn('text-xs font-semibold', vcolor)}>{value}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Team stats */}
          <Section title="Team Performance" icon={Users}>
            {team.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No team members</p>
            ) : (
              <div className="space-y-3">
                {team.slice(0, 5).map((m) => (
                  <div key={m.id} className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold">
                        {m.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </div>
                      <div className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white', m.isOnline ? 'bg-green-500' : 'bg-gray-300')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{m.name}</p>
                      <p className="text-xs text-gray-400">{m.assignedConversations} assigned · {m.resolvedToday} resolved today</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Business Info */}
        <Section title="Business Information" icon={Building2}>
          <p className="text-xs text-gray-400 mb-3">Live data from Meta Business API</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <div>
              <InfoRow label="Business Name"   value={metaBiz?.phone?.verified_name ?? biz?.name} />
              <InfoRow label="Phone Number"    value={metaBiz?.phone?.display_phone_number ?? biz?.phone} mono />
              <InfoRow label="Description"     value={metaBiz?.profile?.description ?? biz?.description} />
              <InfoRow label="About"           value={metaBiz?.profile?.about} />
              <InfoRow label="Industry"        value={metaBiz?.profile?.vertical} />
            </div>
            <div>
              <InfoRow label="Address"         value={metaBiz?.profile?.address ?? biz?.address} />
              <InfoRow label="Email"           value={metaBiz?.profile?.email ?? biz?.email} />
              <InfoRow label="Quality Rating"  value={metaBiz?.phone?.quality_rating} />
              <InfoRow label="Messaging Limit" value={metaBiz?.phone?.messaging_limit_tier} />
              <InfoRow label="Website"         value={
                (metaBiz?.profile?.websites?.[0] ?? biz?.website)
                  ? <a href={metaBiz?.profile?.websites?.[0] ?? biz?.website} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">
                      {metaBiz?.profile?.websites?.[0] ?? biz?.website}
                    </a>
                  : null
              } />
            </div>
          </div>
        </Section>

      </div>
    </div>
  );
}
