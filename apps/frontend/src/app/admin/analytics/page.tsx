'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, BarChart, Bar, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { adminAnalyticsApi } from '@/lib/admin-api';
import toast from 'react-hot-toast';

interface Analytics {
  workspaceGrowth: { date: string; count: number }[];
  messageVolume: { date: string; count: number }[];
  activeUsers: { date: string; count: number }[];
  planDistribution: { plan: string; count: number }[];
  channelDistribution: { type: string; count: number }[];
}

const PLAN_COLORS: Record<string, string> = {
  starter: '#64748b',
  growth: '#3b82f6',
  pro: '#8b5cf6',
  enterprise: '#f59e0b',
};

const CHANNEL_COLORS = ['#25D366', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function shortDate(d: string) {
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    adminAnalyticsApi.get(days)
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [days]);

  const tooltipStyle = {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#cbd5e1',
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Growth and activity across the platform.</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                days === d ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="w-4 h-4 border-2 border-slate-600 border-t-[#25D366] rounded-full animate-spin" />
          Loading...
        </div>
      ) : data ? (
        <div className="space-y-5">
          {/* Message volume */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-sm font-semibold text-white mb-4">Message volume</p>
            {data.messageVolume.length === 0 ? (
              <p className="text-slate-600 text-sm">No data for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.messageVolume.map((d) => ({ ...d, date: shortDate(d.date) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="count" fill="#25D366" radius={[3, 3, 0, 0]} name="Messages" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {/* Workspace growth */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-sm font-semibold text-white mb-4">New workspaces</p>
              {data.workspaceGrowth.length === 0 ? (
                <p className="text-slate-600 text-sm">No new workspaces in this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={data.workspaceGrowth.map((d) => ({ ...d, date: shortDate(d.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Workspaces" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Active users */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-sm font-semibold text-white mb-4">Daily active members</p>
              {data.activeUsers.length === 0 ? (
                <p className="text-slate-600 text-sm">No login data for this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={data.activeUsers.map((d) => ({ ...d, date: shortDate(d.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} name="Active users" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {/* Plan distribution */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-sm font-semibold text-white mb-4">Plan distribution</p>
              {data.planDistribution.length === 0 ? (
                <p className="text-slate-600 text-sm">No workspaces yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={data.planDistribution}
                      dataKey="count"
                      nameKey="plan"
                      cx="50%"
                      cy="50%"
                      outerRadius={65}
                      innerRadius={35}
                      paddingAngle={3}
                    >
                      {data.planDistribution.map((entry) => (
                        <Cell key={entry.plan} fill={PLAN_COLORS[entry.plan] ?? '#64748b'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => <span style={{ color: '#94a3b8', fontSize: 11, textTransform: 'capitalize' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel type distribution */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-sm font-semibold text-white mb-4">Active channel types</p>
              {data.channelDistribution.length === 0 ? (
                <p className="text-slate-600 text-sm">No active channels.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.channelDistribution} layout="vertical">
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="type" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="count" radius={[0, 3, 3, 0]} name="Channels">
                      {data.channelDistribution.map((_, i) => (
                        <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-slate-500 text-sm">Failed to load analytics.</p>
      )}
    </div>
  );
}
