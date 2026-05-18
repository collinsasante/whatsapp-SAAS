'use client';
import { useEffect, useState } from 'react';
import {
  Building2, Users, MessageSquare, Radio, BarChart3, TrendingUp,
  AlertCircle, CheckCircle2, Package, Activity, Megaphone, Contact,
  Gauge, ShieldCheck, Wrench, Sparkles,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { adminDashboardApi, adminAnalyticsApi, adminAuditApi, adminSettingsApi } from '@/lib/admin-api';
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

interface AnalyticsData {
  workspaceGrowth: { date: string; count: number }[];
  messageVolume: { date: string; count: number }[];
  activeUsers: { date: string; count: number }[];
  planDistribution: { plan: string; count: number }[];
  channelDistribution: { type: string; count: number }[];
}

interface AuditLog {
  id: string; action: string; resourceType: string | null; resourceId: string | null;
  metadata: Record<string, unknown> | null; ipAddress: string | null; createdAt: string;
  admin: { id: string; email: string; name: string } | null;
}

interface PlatformSetting {
  id: string; key: string; value: unknown; description: string | null; updatedAt: string;
}

function StatCard({
  icon: Icon, label, value, sub, iconBg, trend,
}: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; iconBg: string; trend?: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', iconBg)}>
          <Icon size={17} className="text-white" />
        </div>
        {trend && (
          <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
            {trend}
          </span>
        )}
      </div>
      <p className="text-slate-500 text-xs font-medium mb-1">{label}</p>
      <p className="text-slate-900 text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="text-slate-400 text-xs mt-1">{sub}</p>}
    </div>
  );
}

const ACTION_BADGE: Record<string, string> = {
  ADMIN_LOGIN: 'bg-blue-50 text-blue-600 border-blue-100',
  ADMIN_LOGOUT: 'bg-slate-100 text-slate-500 border-slate-200',
  WORKSPACE_SUSPENDED: 'bg-red-50 text-red-600 border-red-100',
  WORKSPACE_REACTIVATED: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  WORKSPACE_DELETED: 'bg-red-50 text-red-700 border-red-100',
  WORKSPACE_PLAN_CHANGED: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  IMPERSONATION_STARTED: 'bg-amber-50 text-amber-600 border-amber-100',
  USER_SUSPENDED: 'bg-orange-50 text-orange-600 border-orange-100',
  USER_REACTIVATED: 'bg-teal-50 text-teal-600 border-teal-100',
  SETTING_UPDATED: 'bg-purple-50 text-purple-600 border-purple-100',
};

function relativeTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      adminDashboardApi.stats(),
      adminAnalyticsApi.get(7),
      adminAuditApi.list({ limit: 5 }),
      adminSettingsApi.getAll(),
    ])
      .then(([statsRes, analyticsRes, auditRes, settingsRes]) => {
        setStats(statsRes.data as GlobalStats);
        setAnalytics(analyticsRes.data as AnalyticsData);
        const auditData = auditRes.data as { data: AuditLog[] };
        setAuditLogs(auditData.data ?? []);
        setSettings(settingsRes.data as PlatformSetting[]);
      })
      .catch(() => setError('Failed to load dashboard data'))
      .finally(() => setLoading(false));
  }, []);

  const getSetting = (key: string) => settings.find((s) => s.key === key)?.value;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const deliveryRate = stats?.campaigns?.sent
    ? Math.round((stats.campaigns.delivered / stats.campaigns.sent) * 100)
    : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-slate-900 text-xl font-bold">Overview</h1>
        <p className="text-slate-500 text-sm mt-0.5">{today}</p>
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

      {stats && !loading && (
        <>
          {/* Row 1 — primary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard
              icon={Building2} label="Workspaces" value={stats.workspaces.total}
              sub={`${stats.workspaces.active} active · ${stats.workspaces.suspended} suspended`}
              iconBg="bg-indigo-500" trend={`+${stats.workspaces.newThisMonth} this month`}
            />
            <StatCard
              icon={Users} label="Total Users" value={stats.users.total}
              sub={`${stats.users.active} active`}
              iconBg="bg-blue-500"
            />
            <StatCard
              icon={MessageSquare} label="Total Messages (7d)" value={stats.messages.today}
              sub="sent in last 7 days"
              iconBg="bg-teal-500"
            />
            <StatCard
              icon={Radio} label="Active Channels" value={stats.channels.active}
              sub={`of ${stats.channels.total} total channels`}
              iconBg="bg-emerald-500"
            />
          </div>

          {/* Row 2 — secondary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              icon={Activity} label="Conversations" value={stats.conversations.total}
              sub={`${stats.conversations.open} currently open`}
              iconBg="bg-violet-500"
            />
            <StatCard
              icon={Megaphone} label="Campaigns" value={stats.campaigns.total}
              sub={`${stats.campaigns.sent.toLocaleString()} messages sent`}
              iconBg="bg-orange-500"
            />
            <StatCard
              icon={Contact} label="Contacts" value={stats.contacts.total}
              sub="across all workspaces"
              iconBg="bg-pink-500"
            />
            <StatCard
              icon={BarChart3} label="Delivery Rate" value={`${deliveryRate}%`}
              sub={`${stats.campaigns.delivered.toLocaleString()} delivered`}
              iconBg="bg-cyan-500"
            />
          </div>

          {/* Charts row */}
          {analytics && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* Message Volume Area Chart */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-slate-800 text-sm font-semibold">Message Volume</h2>
                    <p className="text-slate-400 text-xs mt-0.5">Last 7 days</p>
                  </div>
                  <span className="text-xs text-teal-600 font-medium bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100">
                    {analytics.messageVolume.reduce((s, d) => s + d.count, 0).toLocaleString()} msgs
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={analytics.messageVolume} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }}
                      labelStyle={{ color: '#475569' }}
                    />
                    <Area type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2} fill="url(#msgGrad)" name="Messages" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* New Workspaces Bar Chart */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-slate-800 text-sm font-semibold">New Workspaces</h2>
                    <p className="text-slate-400 text-xs mt-0.5">Last 7 days</p>
                  </div>
                  <span className="text-xs text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                    {analytics.workspaceGrowth.reduce((s, d) => s + d.count, 0)} new
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={analytics.workspaceGrowth} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }}
                      labelStyle={{ color: '#475569' }}
                    />
                    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Workspaces" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Bottom row: Audit events + System health */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Recent Audit Events */}
            <div className="lg:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <h2 className="text-slate-800 text-sm font-semibold mb-4">Recent Activity</h2>
              {auditLogs.length === 0 ? (
                <p className="text-slate-400 text-xs text-center py-6">No recent events</p>
              ) : (
                <div className="space-y-3">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-[10px] font-bold flex-shrink-0 mt-0.5">
                        {log.admin?.name?.slice(0, 2).toUpperCase() ?? 'SY'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded border', ACTION_BADGE[log.action] ?? 'bg-slate-50 text-slate-500 border-slate-200')}>
                            {log.action.replace(/_/g, ' ')}
                          </span>
                          <span className="text-slate-600 text-xs truncate">{log.admin?.email ?? 'System'}</span>
                        </div>
                        {log.metadata && typeof log.metadata['name'] === 'string' && (
                          <p className="text-slate-400 text-[10px] mt-0.5 italic">"{log.metadata['name'] as string}"</p>
                        )}
                      </div>
                      <span className="text-slate-400 text-[10px] flex-shrink-0">{relativeTime(log.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* System Health */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <h2 className="text-slate-800 text-sm font-semibold mb-4">System Health</h2>
              <div className="space-y-3">
                {/* Registration */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck size={14} className="text-slate-500" />
                    <div>
                      <p className="text-slate-700 text-xs font-medium">Registrations</p>
                      <p className="text-slate-400 text-[10px]">New workspace sign-ups</p>
                    </div>
                  </div>
                  {getSetting('registration_enabled') !== false ? (
                    <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                      <CheckCircle2 size={9} /> Open
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-600 text-[10px] font-semibold bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                      <AlertCircle size={9} /> Closed
                    </span>
                  )}
                </div>

                {/* Maintenance */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <Wrench size={14} className="text-slate-500" />
                    <div>
                      <p className="text-slate-700 text-xs font-medium">Maintenance</p>
                      <p className="text-slate-400 text-[10px]">Platform-wide mode</p>
                    </div>
                  </div>
                  {getSetting('maintenance_mode') ? (
                    <span className="flex items-center gap-1 text-amber-600 text-[10px] font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                      <AlertCircle size={9} /> Active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                      <CheckCircle2 size={9} /> Normal
                    </span>
                  )}
                </div>

                {/* AI Features */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <Sparkles size={14} className="text-slate-500" />
                    <div>
                      <p className="text-slate-700 text-xs font-medium">AI Features</p>
                      <p className="text-slate-400 text-[10px]">Platform-wide AI</p>
                    </div>
                  </div>
                  {getSetting('ai_enabled') !== false ? (
                    <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                      <CheckCircle2 size={9} /> Enabled
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-slate-500 text-[10px] font-semibold bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                      Disabled
                    </span>
                  )}
                </div>

                {/* Delivery rate bar */}
                {stats.campaigns.sent > 0 && (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Gauge size={13} className="text-slate-500" />
                        <span className="text-slate-700 text-xs font-medium">Delivery Rate</span>
                      </div>
                      <span className="text-slate-700 text-xs font-bold">{deliveryRate}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', deliveryRate >= 80 ? 'bg-emerald-500' : deliveryRate >= 60 ? 'bg-amber-500' : 'bg-red-500')}
                        style={{ width: `${deliveryRate}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
