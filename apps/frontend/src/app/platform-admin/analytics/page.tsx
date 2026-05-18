'use client';
import { useEffect, useState } from 'react';
import { Building2, Users, MessageSquare, TrendingUp, AlertCircle } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { adminAnalyticsApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';

interface AnalyticsData {
  workspaceGrowth: { date: string; count: number }[];
  messageVolume: { date: string; count: number }[];
  activeUsers: { date: string; count: number }[];
  planDistribution: { plan: string; count: number }[];
  channelDistribution: { type: string; count: number }[];
}

const PLAN_COLORS: Record<string, string> = {
  FREE: '#94a3b8', free: '#94a3b8',
  PRO: '#3b82f6', pro: '#3b82f6',
  BUSINESS: '#6366f1', business: '#6366f1',
  ENTERPRISE: '#8b5cf6', enterprise: '#8b5cf6',
  STARTER: '#22d3ee', starter: '#22d3ee',
};

const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: '#10b981', INSTAGRAM: '#ec4899',
  FACEBOOK_MESSENGER: '#3b82f6', TELEGRAM: '#0ea5e9',
  EMAIL: '#f97316', WEB_CHAT: '#6b7280', TIKTOK: '#1e293b',
};

function sum(arr: { count: number }[]) { return arr.reduce((s, d) => s + d.count, 0); }

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    adminAnalyticsApi.get(days)
      .then((r) => setData(r.data as AnalyticsData))
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div className="p-7 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-slate-400 text-sm mt-0.5">Platform-wide growth metrics and activity trends</p>
        </div>
        <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">
          {([7, 14, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                'px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                days === d ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm mb-6">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            {[
              { icon: Building2, label: `New Workspaces`, value: sum(data.workspaceGrowth), sub: `in ${days} days`, color: 'bg-indigo-500' },
              { icon: MessageSquare, label: `Messages`, value: sum(data.messageVolume).toLocaleString(), sub: `total volume`, color: 'bg-teal-500' },
              { icon: Users, label: `Active Users`, value: sum(data.activeUsers).toLocaleString(), sub: `unique logins`, color: 'bg-blue-500' },
              {
                icon: TrendingUp,
                label: 'Avg. Daily Msgs',
                value: data.messageVolume.length > 0 ? Math.round(sum(data.messageVolume) / data.messageVolume.length).toLocaleString() : '0',
                sub: `per day`,
                color: 'bg-violet-500',
              },
            ].map(({ icon: Icon, label, value, sub, color }) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-4', color)}>
                  <Icon size={16} className="text-white" />
                </div>
                <p className="text-3xl font-bold text-slate-900 tracking-tight leading-none">{value}</p>
                <p className="text-slate-500 text-xs font-medium mt-1.5">{label}</p>
                <p className="text-slate-400 text-[11px] mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* Message Volume Area Chart */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-slate-800 text-sm font-bold">Message Volume</h2>
                <p className="text-slate-400 text-xs mt-0.5">Daily messages over the last {days} days</p>
              </div>
              <span className="text-teal-700 text-xs font-bold bg-teal-50 px-3 py-1 rounded-full border border-teal-100">
                {sum(data.messageVolume).toLocaleString()} total
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.messageVolume} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="msgVol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#475569', fontWeight: 600 }} />
                <Area type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2.5} fill="url(#msgVol)" name="Messages" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Workspace growth + Active users */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-slate-800 text-sm font-bold">New Workspaces</h2>
                  <p className="text-slate-400 text-xs mt-0.5">Daily registrations over {days} days</p>
                </div>
                <span className="text-indigo-700 text-xs font-bold bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                  {sum(data.workspaceGrowth)} registered
                </span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.workspaceGrowth} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#475569', fontWeight: 600 }} />
                  <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} name="New Workspaces" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-slate-800 text-sm font-bold">Daily Active Users</h2>
                  <p className="text-slate-400 text-xs mt-0.5">Unique logins per day over {days} days</p>
                </div>
                <span className="text-blue-700 text-xs font-bold bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                  {sum(data.activeUsers).toLocaleString()} logins
                </span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data.activeUsers} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="usersGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#475569', fontWeight: 600 }} />
                  <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2.5} fill="url(#usersGrad)" name="Active Users" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Distribution charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h2 className="text-slate-800 text-sm font-bold mb-0.5">Plan Distribution</h2>
              <p className="text-slate-400 text-xs mb-5">{data.planDistribution.reduce((s, d) => s + d.count, 0)} workspaces total</p>
              {data.planDistribution.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No data</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={data.planDistribution} dataKey="count" nameKey="plan" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3}>
                        {data.planDistribution.map((entry, index) => (
                          <Cell key={entry.plan} fill={PLAN_COLORS[entry.plan] ?? ['#6366f1', '#8b5cf6', '#a78bfa'][index % 3]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} formatter={(value) => [typeof value === 'number' ? value.toLocaleString() : value, 'Workspaces']} />
                      <Legend formatter={(value: string) => <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {data.planDistribution.map((entry, index) => {
                      const total = data.planDistribution.reduce((s, d) => s + d.count, 0);
                      const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
                      const color = PLAN_COLORS[entry.plan] ?? ['#6366f1', '#8b5cf6', '#a78bfa'][index % 3];
                      return (
                        <div key={entry.plan}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-slate-600 text-[11px] font-medium uppercase">{entry.plan}</span>
                            <span className="text-slate-700 text-[11px] font-bold">{entry.count} ({pct}%)</span>
                          </div>
                          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h2 className="text-slate-800 text-sm font-bold mb-0.5">Channel Type Distribution</h2>
              <p className="text-slate-400 text-xs mb-5">{data.channelDistribution.reduce((s, d) => s + d.count, 0)} channels total</p>
              {data.channelDistribution.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.channelDistribution} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="type" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={120} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Channels">
                      {data.channelDistribution.map((entry) => (
                        <Cell key={entry.type} fill={CHANNEL_COLORS[entry.type] ?? '#6366f1'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Daily breakdown table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-slate-800 text-sm font-bold">Daily Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="text-left px-5 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Date</th>
                    <th className="text-right px-5 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">New Workspaces</th>
                    <th className="text-right px-5 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Messages</th>
                    <th className="text-right px-5 py-3 text-slate-400 text-[11px] font-semibold uppercase tracking-wider">Active Users</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const allDates = [...new Set([...data.workspaceGrowth.map((d) => d.date), ...data.messageVolume.map((d) => d.date), ...data.activeUsers.map((d) => d.date)])].sort((a, b) => b.localeCompare(a));
                    return allDates.map((date) => {
                      const ws = data.workspaceGrowth.find((d) => d.date === date)?.count ?? 0;
                      const msgs = data.messageVolume.find((d) => d.date === date)?.count ?? 0;
                      const usrs = data.activeUsers.find((d) => d.date === date)?.count ?? 0;
                      return (
                        <tr key={date} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="px-5 py-3 text-slate-500 text-xs font-medium">{date}</td>
                          <td className="px-5 py-3 text-right"><span className="text-indigo-600 text-xs font-semibold">{ws}</span></td>
                          <td className="px-5 py-3 text-right"><span className="text-teal-600 text-xs font-semibold">{msgs.toLocaleString()}</span></td>
                          <td className="px-5 py-3 text-right"><span className="text-blue-600 text-xs font-semibold">{usrs}</span></td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
