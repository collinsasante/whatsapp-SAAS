'use client';
import { useEffect, useState } from 'react';
import { Building2, Users, MessageSquare, Radio, BarChart3, TrendingUp, AlertCircle, CheckCircle2, Package } from 'lucide-react';
import { adminDashboardApi } from '@/lib/admin-api';
import { cn } from '@/lib/utils';

interface GlobalStats {
  workspaces: { total: number; active: number; suspended: number; newThisMonth: number };
  users: { total: number; active: number };
  conversations: { total: number; open: number };
  messages: { total: number; today: number };
  channels: { total: number; active: number };
  campaigns: { total: number; sent: number; delivered: number; read: number; failed: number };
  contacts: { total: number };
}

function StatCard({
  icon: Icon, label, value, sub, color, trend,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  trend?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
          <Icon size={16} className="text-white" />
        </div>
        {trend && (
          <span className="text-xs text-emerald-400 font-medium bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-900/50">
            {trend}
          </span>
        )}
      </div>
      <p className="text-gray-500 text-xs font-medium mb-1">{label}</p>
      <p className="text-white text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="text-gray-600 text-xs mt-1">{sub}</p>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminDashboardApi.stats()
      .then((r) => setStats(r.data as GlobalStats))
      .catch(() => setError('Failed to load dashboard stats'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-white text-xl font-bold">Platform Dashboard</h1>
        <p className="text-gray-500 text-sm mt-0.5">Global metrics across all workspaces</p>
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

      {stats && !loading && (
        <>
          {/* Primary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              icon={Building2} label="Total Workspaces" value={stats.workspaces.total}
              sub={`${stats.workspaces.active} active · ${stats.workspaces.suspended} suspended`}
              color="bg-violet-600" trend={`+${stats.workspaces.newThisMonth} this month`}
            />
            <StatCard
              icon={Users} label="Total Users" value={stats.users.total}
              sub={`${stats.users.active} active users`}
              color="bg-blue-600"
            />
            <StatCard
              icon={MessageSquare} label="Conversations" value={stats.conversations.total}
              sub={`${stats.conversations.open} currently open`}
              color="bg-teal-600"
            />
            <StatCard
              icon={BarChart3} label="Total Messages" value={stats.messages.total}
              sub={`${stats.messages.today.toLocaleString()} sent today`}
              color="bg-emerald-600"
            />
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              icon={Radio} label="Channels" value={stats.channels.total}
              sub={`${stats.channels.active} active`}
              color="bg-orange-600"
            />
            <StatCard
              icon={TrendingUp} label="Campaigns" value={stats.campaigns.total}
              sub={`${stats.campaigns.sent.toLocaleString()} messages sent`}
              color="bg-rose-600"
            />
            <StatCard
              icon={Users} label="Contacts" value={stats.contacts.total}
              sub="across all workspaces"
              color="bg-indigo-600"
            />
            <StatCard
              icon={Package} label="Delivered" value={stats.campaigns.delivered.toLocaleString()}
              sub={`${stats.campaigns.read.toLocaleString()} read · ${stats.campaigns.failed.toLocaleString()} failed`}
              color="bg-cyan-600"
            />
          </div>

          {/* Campaign delivery health */}
          {stats.campaigns.sent > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
              <h2 className="text-white text-sm font-semibold mb-4">Campaign Delivery Health</h2>
              <div className="space-y-3">
                {[
                  { label: 'Delivery Rate', value: stats.campaigns.sent > 0 ? Math.round((stats.campaigns.delivered / stats.campaigns.sent) * 100) : 0, color: 'bg-emerald-500' },
                  { label: 'Read Rate', value: stats.campaigns.sent > 0 ? Math.round((stats.campaigns.read / stats.campaigns.sent) * 100) : 0, color: 'bg-blue-500' },
                  { label: 'Failure Rate', value: stats.campaigns.sent > 0 ? Math.round((stats.campaigns.failed / stats.campaigns.sent) * 100) : 0, color: 'bg-rose-500' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-gray-400 text-xs">{label}</span>
                      <span className="text-white text-xs font-semibold">{value}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Workspace Health</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-500" /><span className="text-gray-300 text-xs">Active workspaces</span></div>
                  <span className="text-white text-xs font-semibold">{stats.workspaces.active}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><AlertCircle size={13} className="text-amber-500" /><span className="text-gray-300 text-xs">Suspended workspaces</span></div>
                  <span className="text-white text-xs font-semibold">{stats.workspaces.suspended}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><TrendingUp size={13} className="text-blue-400" /><span className="text-gray-300 text-xs">New this month</span></div>
                  <span className="text-white text-xs font-semibold">+{stats.workspaces.newThisMonth}</span>
                </div>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Channel Status</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-500" /><span className="text-gray-300 text-xs">Active channels</span></div>
                  <span className="text-white text-xs font-semibold">{stats.channels.active}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><AlertCircle size={13} className="text-red-500" /><span className="text-gray-300 text-xs">Inactive channels</span></div>
                  <span className="text-white text-xs font-semibold">{stats.channels.total - stats.channels.active}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Radio size={13} className="text-violet-400" /><span className="text-gray-300 text-xs">Total channels</span></div>
                  <span className="text-white text-xs font-semibold">{stats.channels.total}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
