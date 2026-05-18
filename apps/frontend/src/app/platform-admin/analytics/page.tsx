'use client';
import { useEffect, useState } from 'react';
import { Building2, Users, MessageSquare, AlertCircle } from 'lucide-react';
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
  FREE: '#94a3b8',
  free: '#94a3b8',
  PRO: '#3b82f6',
  pro: '#3b82f6',
  BUSINESS: '#6366f1',
  business: '#6366f1',
  ENTERPRISE: '#8b5cf6',
  enterprise: '#8b5cf6',
  STARTER: '#22d3ee',
  starter: '#22d3ee',
};

const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: '#10b981',
  INSTAGRAM: '#ec4899',
  FACEBOOK_MESSENGER: '#3b82f6',
  TELEGRAM: '#0ea5e9',
  EMAIL: '#f97316',
  WEB_CHAT: '#6b7280',
  TIKTOK: '#1e293b',
};

const PIE_FALLBACK_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'];

function total(arr: { count: number }[]) {
  return arr.reduce((s, d) => s + d.count, 0);
}

function StatCard({ icon: Icon, label, value, sub, iconBg }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-4', iconBg)}>
        <Icon size={17} className="text-white" />
      </div>
      <p className="text-slate-500 text-xs font-medium mb-1">{label}</p>
      <p className="text-slate-900 text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="text-slate-400 text-xs mt-1">{sub}</p>}
    </div>
  );
}

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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Analytics</h1>
          <p className="text-slate-500 text-sm mt-0.5">Global platform growth and activity metrics</p>
        </div>
        {/* Time range selector */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
          {([7, 14, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                days === d ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm mb-6">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Row 1 — stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard
              icon={Building2}
              label={`New Workspaces (${days}d)`}
              value={total(data.workspaceGrowth)}
              sub="registered in period"
              iconBg="bg-indigo-500"
            />
            <StatCard
              icon={MessageSquare}
              label={`Messages (${days}d)`}
              value={total(data.messageVolume)}
              sub="total message volume"
              iconBg="bg-teal-500"
            />
            <StatCard
              icon={Users}
              label={`Active Users (${days}d)`}
              value={total(data.activeUsers)}
              sub="unique logins"
              iconBg="bg-blue-500"
            />
          </div>

          {/* Message Volume Area Chart */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-slate-800 text-sm font-semibold">Message Volume</h2>
                <p className="text-slate-400 text-xs mt-0.5">Daily messages over the last {days} days</p>
              </div>
              <span className="text-xs text-teal-600 font-medium bg-teal-50 px-2.5 py-1 rounded-full border border-teal-100">
                {total(data.messageVolume).toLocaleString()} total
              </span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.messageVolume} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="msgVol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ color: '#475569', fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2.5} fill="url(#msgVol)" name="Messages" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* New Workspaces Bar Chart */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-slate-800 text-sm font-semibold">Daily New Workspaces</h2>
                <p className="text-slate-400 text-xs mt-0.5">Workspace registrations over {days} days</p>
              </div>
              <span className="text-xs text-indigo-600 font-medium bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
                {total(data.workspaceGrowth)} registered
              </span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.workspaceGrowth} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ color: '#475569', fontWeight: 600 }}
                />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="New Workspaces" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Two-column: Plan Distribution + Channel Types */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* Plan Distribution Pie */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h2 className="text-slate-800 text-sm font-semibold mb-1">Plan Distribution</h2>
              <p className="text-slate-400 text-xs mb-5">{data.planDistribution.reduce((s, d) => s + d.count, 0)} workspaces total</p>
              {data.planDistribution.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={data.planDistribution}
                      dataKey="count"
                      nameKey="plan"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                    >
                      {data.planDistribution.map((entry, index) => (
                        <Cell
                          key={entry.plan}
                          fill={PLAN_COLORS[entry.plan] ?? PIE_FALLBACK_COLORS[index % PIE_FALLBACK_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }}
                      formatter={(value) => [typeof value === 'number' ? value.toLocaleString() : String(value), 'Workspaces']}
                    />
                    <Legend
                      formatter={(value: string) => <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel Type Distribution Horizontal Bar */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h2 className="text-slate-800 text-sm font-semibold mb-1">Channel Type Distribution</h2>
              <p className="text-slate-400 text-xs mb-5">{data.channelDistribution.reduce((s, d) => s + d.count, 0)} channels total</p>
              {data.channelDistribution.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-400 text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={data.channelDistribution}
                    layout="vertical"
                    margin={{ top: 0, right: 20, bottom: 0, left: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="type" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={110} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }}
                    />
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
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h2 className="text-slate-800 text-sm font-semibold mb-4">Daily Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left pb-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Date</th>
                    <th className="text-right pb-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">New Workspaces</th>
                    <th className="text-right pb-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Messages</th>
                    <th className="text-right pb-3 text-slate-500 text-xs font-semibold uppercase tracking-wider">Active Users</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const allDates = [...new Set([
                      ...data.workspaceGrowth.map((d) => d.date),
                      ...data.messageVolume.map((d) => d.date),
                      ...data.activeUsers.map((d) => d.date),
                    ])].sort((a, b) => b.localeCompare(a));

                    return allDates.map((date) => {
                      const ws = data.workspaceGrowth.find((d) => d.date === date)?.count ?? 0;
                      const msgs = data.messageVolume.find((d) => d.date === date)?.count ?? 0;
                      const usrs = data.activeUsers.find((d) => d.date === date)?.count ?? 0;
                      return (
                        <tr key={date} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="py-2.5 text-slate-600 text-xs">{date}</td>
                          <td className="py-2.5 text-right">
                            <span className="text-indigo-600 text-xs font-medium">{ws}</span>
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="text-teal-600 text-xs font-medium">{msgs.toLocaleString()}</span>
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="text-blue-600 text-xs font-medium">{usrs}</span>
                          </td>
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
