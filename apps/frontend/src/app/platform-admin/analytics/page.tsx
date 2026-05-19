'use client';
import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, TrendingUp } from 'lucide-react';
import { platformAdminApi } from '@/lib/platform-admin-api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export default function AnalyticsPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

  async function load() {
    setLoading(true);
    try {
      const res = await platformAdminApi.getAnalytics(range);
      setData(res.data);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [range]);

  const workspaceGrowth = (data?.workspaceGrowth as { date: string; count: number }[]) ?? [];
  const messageVolume = (data?.messageVolume as { date: string; count: number }[]) ?? [];

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-slate-500 text-sm mt-0.5">Platform growth and activity</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-white/4 border border-white/8 rounded-xl p-1">
            {RANGES.map(({ label, days }) => (
              <button
                key={days}
                onClick={() => setRange(days)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  range === days ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-slate-400 hover:text-white text-sm transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 gap-5">
          {[0, 1].map(i => <div key={i} className="h-72 bg-white/[0.02] border border-white/8 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5">
          {/* Workspace growth */}
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp size={16} className="text-teal-400" />
              <h2 className="text-white font-semibold text-sm">Workspace Growth</h2>
            </div>
            {workspaceGrowth.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={workspaceGrowth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-slate-600 text-sm">
                <BarChart3 size={32} className="mr-2 opacity-30" /> No data for this period
              </div>
            )}
          </div>

          {/* Message volume */}
          <div className="bg-white/[0.02] border border-white/8 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <BarChart3 size={16} className="text-blue-400" />
              <h2 className="text-white font-semibold text-sm">Message Volume</h2>
            </div>
            {messageVolume.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={messageVolume}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', fontSize: 12 }} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-slate-600 text-sm">
                <BarChart3 size={32} className="mr-2 opacity-30" /> No data for this period
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
