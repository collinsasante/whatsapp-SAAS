'use client';
import { useEffect, useState } from 'react';
import {
  Users, MessageSquare, Send, Megaphone, TrendingUp, CheckCircle,
  Clock, XCircle, BarChart3, RefreshCw, UserCheck, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { dashboardApi, campaignsApi, contactsApi, conversationsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Stats { contacts: number; conversations: number; messages: number; campaigns: number; }
interface ConvBreakdown { open: number; resolved: number; pending: number; }
interface CampBreakdown { draft: number; scheduled: number; running: number; paused: number; completed: number; failed: number; }
interface Campaign {
  id: string; name: string; status: string;
  totalRecipients: number; sentCount: number; deliveredCount: number; readCount: number; failedCount: number;
}
interface TeamMember {
  id: string; name: string; email: string; avatarUrl: string | null;
  assignedConversations: number; activeConversations: number;
  resolvedToday: number; isOnline: boolean; avgResponseMs: number | null;
}
interface TrendPoint { date: string; opened: number; resolved: number; }

const RANGE_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtMs(ms: number | null) {
  if (ms === null) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function ProgressBar({ label, value, total, color, textColor }: {
  label: string; value: number; total: number; color: string; textColor: string;
}) {
  const p = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-gray-600">{label}</span>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-semibold', textColor)}>{value.toLocaleString()}</span>
          <span className="text-xs text-gray-400">({p}%)</span>
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [conv, setConv] = useState<ConvBreakdown>({ open: 0, resolved: 0, pending: 0 });
  const [camp, setCamp] = useState<CampBreakdown>({ draft: 0, scheduled: 0, running: 0, paused: 0, completed: 0, failed: 0 });
  const [topCampaigns, setTopCampaigns] = useState<Campaign[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [rangeDays, setRangeDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [contactsRes, convsRes, campsRes, teamRes, trendRes] = await Promise.all([
        contactsApi.list({ limit: 1 }),
        conversationsApi.list({ limit: 1 }),
        campaignsApi.list({ limit: 50 }),
        dashboardApi.teamStats(),
        dashboardApi.conversationTrend(rangeDays),
      ]);

      const allConvs: { status: string }[] = (await conversationsApi.list({ limit: 9999 })).data.items ?? [];
      const allCamps: Campaign[] = campsRes.data.items ?? [];

      setStats({
        contacts: contactsRes.data.total ?? 0,
        conversations: convsRes.data.total ?? 0,
        messages: 0,
        campaigns: allCamps.length,
      });

      const open = allConvs.filter(c => c.status === 'OPEN').length;
      const resolved = allConvs.filter(c => c.status === 'RESOLVED').length;
      const pending = allConvs.filter(c => c.status === 'PENDING').length;
      setConv({ open, resolved, pending });

      const campStatuses = ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED'];
      const breakdown = Object.fromEntries(
        campStatuses.map(s => [s.toLowerCase(), allCamps.filter(c => c.status === s).length])
      ) as unknown as CampBreakdown;
      setCamp(breakdown);

      const sorted = [...allCamps].sort((a, b) => b.totalRecipients - a.totalRecipients);
      setTopCampaigns(sorted.slice(0, 8));
      setTeam(teamRes.data as TeamMember[]);
      setTrend((trendRes.data as TrendPoint[]).map(p => ({ ...p, date: fmtDate(p.date) })));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, [rangeDays]);

  const totalSent = topCampaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalDelivered = topCampaigns.reduce((s, c) => s + c.deliveredCount, 0);
  const totalRead = topCampaigns.reduce((s, c) => s + c.readCount, 0);
  const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;
  const readRate = totalDelivered > 0 ? Math.round((totalRead / totalDelivered) * 100) : 0;
  const totalCamp = Object.values(camp).reduce((a, v) => a + v, 0);

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-gray-50">
        <div className="bg-white border-b border-gray-100 px-6 py-4">
          <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
            <TrendingUp size={18} className="text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
            <p className="text-sm text-gray-500">Workspace performance overview</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Range selector */}
          <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1">
            {RANGE_OPTIONS.map(({ label, days }) => (
              <button
                key={days}
                onClick={() => setRangeDays(days)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                  rangeDays === days ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => { void load(true); }}
            disabled={refreshing}
            className={cn('w-9 h-9 flex items-center justify-center text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors', refreshing && 'animate-spin')}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Users,         label: 'Total Contacts',  value: stats?.contacts ?? 0,      sub: 'All time',            color: 'bg-teal-50 text-teal-600' },
            { icon: MessageSquare, label: 'Conversations',   value: stats?.conversations ?? 0, sub: `${conv.open} open now`, color: 'bg-blue-50 text-blue-600' },
            { icon: Megaphone,     label: 'Campaigns',       value: stats?.campaigns ?? 0,     sub: `${camp.running} running`, color: 'bg-orange-50 text-orange-600' },
            { icon: UserCheck,     label: 'Team Members',    value: team.length,               sub: `${team.filter(m => m.isOnline).length} online`, color: 'bg-purple-50 text-purple-600' },
          ].map(({ icon: Icon, label, value, sub, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500">{label}</span>
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', color)}>
                  <Icon size={17} />
                </div>
              </div>
              <p className="text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">{sub}</p>
            </div>
          ))}
        </div>

        {/* Conversation trend chart */}
        {trend.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={15} className="text-teal-600" />
              <h2 className="font-semibold text-gray-900">Conversation Trend</h2>
              <span className="text-xs text-gray-400 ml-auto">Last {rangeDays} days</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                  interval={Math.floor(trend.length / 6)} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 20px rgba(0,0,0,.08)' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Area type="monotone" dataKey="opened" name="Opened" stroke="#0d9488" strokeWidth={2} fill="url(#gradOpened)" dot={false} />
                <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#6366f1" strokeWidth={2} fill="url(#gradResolved)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Delivery ring */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Delivery Performance</h2>
            <div className="flex flex-col items-center mb-4">
              <div className="relative w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#0d9488" strokeWidth="12"
                    strokeDasharray={`${deliveryRate * 2.51} 251`} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-gray-900">{deliveryRate}%</span>
                  <span className="text-xs text-gray-400">delivered</span>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <ProgressBar label="Sent"      value={totalSent}      total={totalSent || 1} color="bg-gray-300"  textColor="text-gray-700" />
              <ProgressBar label="Delivered" value={totalDelivered} total={totalSent || 1} color="bg-teal-400"  textColor="text-teal-700" />
              <ProgressBar label="Read"      value={totalRead}      total={totalSent || 1} color="bg-teal-600"  textColor="text-teal-800" />
            </div>
            <div className="bg-teal-50 rounded-xl p-3 text-center mt-4">
              <p className="text-xs text-teal-600">Read Rate</p>
              <p className="text-2xl font-bold text-teal-700">{readRate}%</p>
            </div>
          </div>

          {/* Conversations */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Conversations by Status</h2>
            {(conv.open + conv.resolved + conv.pending) === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                <MessageSquare size={32} className="mb-2 opacity-20" />
                <p className="text-sm">No conversations yet</p>
              </div>
            ) : (
              <>
                <div className="space-y-4 mb-4">
                  <ProgressBar label="Open"     value={conv.open}     total={conv.open + conv.resolved + conv.pending} color="bg-green-500"  textColor="text-green-600" />
                  <ProgressBar label="Pending"  value={conv.pending}  total={conv.open + conv.resolved + conv.pending} color="bg-yellow-400" textColor="text-yellow-600" />
                  <ProgressBar label="Resolved" value={conv.resolved} total={conv.open + conv.resolved + conv.pending} color="bg-teal-500"   textColor="text-teal-600" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Open',     value: conv.open,     bg: 'bg-green-50',  text: 'text-green-700' },
                    { label: 'Pending',  value: conv.pending,  bg: 'bg-yellow-50', text: 'text-yellow-700' },
                    { label: 'Resolved', value: conv.resolved, bg: 'bg-teal-50',   text: 'text-teal-700' },
                  ].map(({ label, value, bg, text }) => (
                    <div key={label} className={cn('rounded-xl p-3 text-center', bg)}>
                      <p className={cn('text-xl font-bold', text)}>{value}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Campaign status */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Campaigns by Status</h2>
            {totalCamp === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                <Megaphone size={32} className="mb-2 opacity-20" />
                <p className="text-sm">No campaigns yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { label: 'Running',   value: camp.running,   color: 'bg-yellow-400' },
                  { label: 'Completed', value: camp.completed, color: 'bg-teal-500' },
                  { label: 'Scheduled', value: camp.scheduled, color: 'bg-blue-400' },
                  { label: 'Draft',     value: camp.draft,     color: 'bg-gray-300' },
                  { label: 'Paused',    value: camp.paused,    color: 'bg-orange-400' },
                  { label: 'Failed',    value: camp.failed,    color: 'bg-red-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-20 flex-shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', color)} style={{ width: `${totalCamp > 0 ? (value / totalCamp) * 100 : 0}%` }} />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-6 text-right">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Agent performance table */}
        {team.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <UserCheck size={15} className="text-teal-600" />
              <h2 className="font-semibold text-gray-900">Agent Performance</h2>
              <span className="ml-auto text-xs text-gray-400">{team.filter(m => m.isOnline).length} online now</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Agent</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Assigned</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Active</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Resolved Today</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg Response</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {team.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {member.avatarUrl ? (
                            <img src={member.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-bold">
                              {initials(member.name)}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900">{member.name}</p>
                            <p className="text-xs text-gray-400">{member.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={cn(
                          'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium',
                          member.isOnline ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                        )}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', member.isOnline ? 'bg-green-500' : 'bg-gray-400')} />
                          {member.isOnline ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-gray-900">
                        {member.assignedConversations}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={cn('font-medium', member.activeConversations > 0 ? 'text-teal-600' : 'text-gray-400')}>
                          {member.activeConversations}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={cn('font-semibold', member.resolvedToday > 0 ? 'text-green-600' : 'text-gray-400')}>
                          {member.resolvedToday}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={cn(
                          'text-sm font-medium',
                          member.avgResponseMs === null ? 'text-gray-300'
                            : member.avgResponseMs < 60000 ? 'text-green-600'
                            : member.avgResponseMs < 300000 ? 'text-yellow-600'
                            : 'text-red-500'
                        )}>
                          {fmtMs(member.avgResponseMs)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Campaign delivery bar chart */}
        {topCampaigns.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Send size={15} className="text-teal-600" />
              <h2 className="font-semibold text-gray-900">Campaign Delivery Breakdown</h2>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={topCampaigns.slice(0, 6).map((c) => ({
                  name: c.name.length > 14 ? c.name.slice(0, 14) + '…' : c.name,
                  Sent: c.sentCount, Delivered: c.deliveredCount, Read: c.readCount,
                }))}
                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                barSize={12} barCategoryGap="30%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 20px rgba(0,0,0,.08)' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="Sent"      fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Delivered" fill="#0d9488" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Read"      fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top campaigns table */}
        {topCampaigns.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Campaign Performance</h2>
              <span className="text-xs text-gray-400">Top {topCampaigns.length} by recipients</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Campaign</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Recipients</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sent</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Delivered</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Read</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Read Rate</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topCampaigns.map((c) => {
                    const rRate = c.deliveredCount > 0 ? Math.round((c.readCount / c.deliveredCount) * 100) : 0;
                    const sentPct = c.totalRecipients > 0 ? (c.sentCount / c.totalRecipients) * 100 : 0;
                    const STATUS_CLS: Record<string, string> = {
                      COMPLETED: 'text-teal-600 bg-teal-50', RUNNING: 'text-yellow-700 bg-yellow-50',
                      DRAFT: 'text-gray-600 bg-gray-100', FAILED: 'text-red-600 bg-red-50',
                      PAUSED: 'text-orange-600 bg-orange-50', SCHEDULED: 'text-blue-600 bg-blue-50',
                    };
                    return (
                      <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3.5">
                          <p className="font-medium text-gray-900">{c.name}</p>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_CLS[c.status] ?? 'text-gray-600 bg-gray-100')}>
                            {c.status.toLowerCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium text-gray-900">{c.totalRecipients.toLocaleString()}</td>
                        <td className="px-4 py-3.5 text-right text-gray-600">{c.sentCount.toLocaleString()}</td>
                        <td className="px-4 py-3.5 text-right text-teal-600 font-medium">{c.deliveredCount.toLocaleString()}</td>
                        <td className="px-4 py-3.5 text-right text-purple-600 font-medium">{c.readCount.toLocaleString()}</td>
                        <td className="px-4 py-3.5 text-right">
                          <span className={cn('text-sm font-bold', rRate >= 50 ? 'text-teal-600' : rRate >= 25 ? 'text-yellow-600' : 'text-gray-400')}>
                            {rRate}%
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-500 rounded-full" style={{ width: `${sentPct}%` }} />
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{Math.round(sentPct)}% sent</p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Quick metrics footer */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: CheckCircle, label: 'Open Conversations',  value: conv.open,     cls: 'bg-green-50 border-green-100',  iconCls: 'text-green-600' },
            { icon: Clock,       label: 'Pending Reply',       value: conv.pending,  cls: 'bg-yellow-50 border-yellow-100', iconCls: 'text-yellow-600' },
            { icon: Zap,         label: 'Active Campaigns',    value: camp.running,  cls: 'bg-teal-50 border-teal-100',    iconCls: 'text-teal-600' },
            { icon: XCircle,     label: 'Failed Campaigns',    value: camp.failed,   cls: 'bg-red-50 border-red-100',      iconCls: 'text-red-500' },
          ].map(({ icon: Icon, label, value, cls, iconCls }) => (
            <div key={label} className={cn('rounded-2xl border p-4 flex items-center gap-3', cls)}>
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/60', iconCls)}>
                <Icon size={18} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
