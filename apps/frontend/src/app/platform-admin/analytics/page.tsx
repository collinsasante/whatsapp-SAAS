'use client';
import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Users, MessageSquare, Building2, AlertCircle } from 'lucide-react';
import { adminAnalyticsApi } from '@/lib/admin-api';

interface AnalyticsData {
  workspaceGrowth: { date: string; count: number }[];
  messageVolume: { date: string; count: number }[];
  activeUsers: { date: string; count: number }[];
  planDistribution: { plan: string; count: number }[];
  channelDistribution: { type: string; count: number }[];
}

function Sparkline({ data, color }: { data: { date: string; count: number }[]; color: string }) {
  if (!data.length) return <div className="h-12 flex items-center justify-center text-gray-700 text-xs">No data</div>;
  const max = Math.max(...data.map((d) => d.count), 1);
  const w = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 40`} preserveAspectRatio="none" className="w-full h-12">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={data.map((d, i) => `${i * w + w / 2},${40 - (d.count / max) * 36}`).join(' ')}
      />
      {data.map((d, i) => (
        <circle key={i} cx={i * w + w / 2} cy={40 - (d.count / max) * 36} r="1.5" fill={color} />
      ))}
    </svg>
  );
}

function MiniBar({ data, color }: { data: { plan?: string; type?: string; count: number }[]; color: string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.plan ?? d.type}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-gray-400 text-xs capitalize">{(d.plan ?? d.type ?? '').toLowerCase()}</span>
            <span className="text-white text-xs font-semibold">{d.count}</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(d.count / max) * 100}%`, backgroundColor: color }} />
          </div>
        </div>
      ))}
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
    adminAnalyticsApi.get(days)
      .then((r) => setData(r.data as AnalyticsData))
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [days]);

  const total = (arr: { count: number }[]) => arr.reduce((s, d) => s + d.count, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-bold">Analytics</h1>
          <p className="text-gray-500 text-sm mt-0.5">Global platform growth and activity metrics</p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                days === d ? 'bg-rose-950 text-rose-400 border-rose-900' : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600'
              }`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-950/60 border border-red-900 rounded-xl px-4 py-3 text-red-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Sparkline charts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[
              { icon: Building2, label: 'New Workspaces', sub: `${total(data.workspaceGrowth)} total`, data: data.workspaceGrowth, color: '#8b5cf6' },
              { icon: MessageSquare, label: 'Message Volume', sub: `${total(data.messageVolume).toLocaleString()} msgs`, data: data.messageVolume, color: '#14b8a6' },
              { icon: Users, label: 'Active Users', sub: `${total(data.activeUsers)} logins`, data: data.activeUsers, color: '#3b82f6' },
            ].map(({ icon: Icon, label, sub, data: d, color }) => (
              <div key={label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon size={13} style={{ color }} />
                    <p className="text-gray-300 text-xs font-semibold">{label}</p>
                  </div>
                  <p className="text-white text-sm font-bold">{sub}</p>
                </div>
                <Sparkline data={d} color={color} />
                {d.length > 0 && (
                  <div className="flex justify-between mt-2">
                    <span className="text-gray-700 text-[10px]">{d[0]?.date}</span>
                    <span className="text-gray-700 text-[10px]">{d[d.length - 1]?.date}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Distributions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={13} className="text-violet-400" />
                <h2 className="text-gray-300 text-sm font-semibold">Plan Distribution</h2>
                <span className="ml-auto text-gray-600 text-xs">{data.planDistribution.reduce((s, d) => s + d.count, 0)} workspaces</span>
              </div>
              <MiniBar data={data.planDistribution} color="#8b5cf6" />
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={13} className="text-emerald-400" />
                <h2 className="text-gray-300 text-sm font-semibold">Channel Types</h2>
                <span className="ml-auto text-gray-600 text-xs">{data.channelDistribution.reduce((s, d) => s + d.count, 0)} active</span>
              </div>
              <MiniBar data={data.channelDistribution} color="#10b981" />
            </div>
          </div>

          {/* Data table */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mt-4">
            <h2 className="text-gray-300 text-sm font-semibold mb-4">Daily Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left pb-2 text-gray-500 font-semibold">Date</th>
                    <th className="text-right pb-2 text-gray-500 font-semibold">New Workspaces</th>
                    <th className="text-right pb-2 text-gray-500 font-semibold">Messages</th>
                    <th className="text-right pb-2 text-gray-500 font-semibold">Active Users</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const allDates = [...new Set([
                      ...data.workspaceGrowth.map((d) => d.date),
                      ...data.messageVolume.map((d) => d.date),
                      ...data.activeUsers.map((d) => d.date),
                    ])].sort((a, b) => b.localeCompare(a)).slice(0, 14);

                    return allDates.map((date) => ({
                      date,
                      ws: data.workspaceGrowth.find((d) => d.date === date)?.count ?? 0,
                      msgs: data.messageVolume.find((d) => d.date === date)?.count ?? 0,
                      users: data.activeUsers.find((d) => d.date === date)?.count ?? 0,
                    })).map(({ date, ws, msgs, users: u }) => (
                      <tr key={date} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                        <td className="py-2 text-gray-400">{date}</td>
                        <td className="py-2 text-right text-violet-400 font-medium">{ws}</td>
                        <td className="py-2 text-right text-teal-400 font-medium">{msgs.toLocaleString()}</td>
                        <td className="py-2 text-right text-blue-400 font-medium">{u}</td>
                      </tr>
                    ));
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
