'use client';
import { useEffect, useState } from 'react';
import {
  Building2, Users, MessageSquare, Radio,
  TrendingUp, AlertCircle, CheckCircle2, Wrench, Sparkles,
  ShieldCheck, Activity, Megaphone, Contact,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
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

const PLAN_COLORS: Record<string, string> = {
  FREE: '#94a3b8', free: '#94a3b8',
  PRO: '#3b82f6', pro: '#3b82f6',
  BUSINESS: '#6366f1', business: '#6366f1',
  ENTERPRISE: '#8b5cf6', enterprise: '#8b5cf6',
};

const ACTION_COLORS: Record<string, string> = {
  ADMIN_LOGIN: 'text-blue-600 bg-blue-50 border-blue-100',
  WORKSPACE_SUSPENDED: 'text-red-600 bg-red-50 border-red-100',
  WORKSPACE_REACTIVATED: 'text-emerald-600 bg-emerald-50 border-emerald-100',
  WORKSPACE_DELETED: 'text-red-700 bg-red-50 border-red-200',
  WORKSPACE_PLAN_CHANGED: 'text-indigo-600 bg-indigo-50 border-indigo-100',
  IMPERSONATION_STARTED: 'text-amber-600 bg-amber-50 border-amber-100',
  USER_SUSPENDED: 'text-orange-600 bg-orange-50 border-orange-100',
  USER_REACTIVATED: 'text-teal-600 bg-teal-50 border-teal-100',
  SETTING_UPDATED: 'text-purple-600 bg-purple-50 border-purple-100',
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

function KpiCard({
  label, value, sub, trend, icon: Icon, iconColor, accentColor,
}: {
  label: string; value: string | number; sub?: string; trend?: string;
  icon: React.ElementType; iconColor: string; accentColor: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', iconColor)}>
          <Icon size={16} className="text-white" />
        </div>
        {trend && (
          <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', accentColor)}>
            {trend}
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-bold text-slate-900 tracking-tight leading-none">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-slate-500 text-xs font-medium mt-1.5">{label}</p>
        {sub && <p className="text-slate-400 text-[11px] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
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
      adminAuditApi.list({ limit: 6 }),
      adminSettingsApi.getAll(),
    ])
      .then(([statsRes, analyticsRes, auditRes, settingsRes]) => {
        setStats(statsRes.data as GlobalStats);
        setAnalytics(analyticsRes.data as AnalyticsData);
        setAuditLogs(((auditRes.data as { data: AuditLog[] }).data) ?? []);
        setSettings(settingsRes.data as PlatformSetting[]);
      })
      .catch(() => setError('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  const getSetting = (key: string) => settings.find((s) => s.key === key)?.value;
  const maintenanceOn = getSetting('maintenance_mode') === true;
  const registrationOn = getSetting('registration_enabled') !== false;
  const aiEnabled = getSetting('ai_enabled') !== false;

  const deliveryRate = stats?.campaigns?.sent
    ? Math.round((stats.campaigns.delivered / stats.campaigns.sent) * 100)
    : 0;

  const msgTotal7d = analytics?.messageVolume.reduce((s, d) => s + d.count, 0) ?? 0;
  const wsNew7d = analytics?.workspaceGrowth.reduce((s, d) => s + d.count, 0) ?? 0;

  if (loading) return (
    <div className="flex items-center justify-center flex-1 h-full">
      <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-7 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-slate-900 text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {/* Platform status badges */}
        <div className="flex items-center gap-2">
          {maintenanceOn ? (
            <span className="flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 text-xs font-semibold px-3 py-1.5 rounded-full">
              <Wrench size={11} /> Maintenance ON
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 text-xs font-semibold px-3 py-1.5 rounded-full">
              <CheckCircle2 size={11} /> All Systems Normal
            </span>
          )}
          {!registrationOn && (
            <span className="flex items-center gap-1.5 text-red-700 bg-red-50 border border-red-200 text-xs font-semibold px-3 py-1.5 rounded-full">
              <AlertCircle size={11} /> Registration Closed
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {stats && (
        <>
          {/* KPI Row 1 */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard
              icon={Building2} label="Total Workspaces" iconColor="bg-indigo-500" accentColor="text-indigo-600 bg-indigo-50 border-indigo-100"
              value={stats.workspaces.total}
              sub={`${stats.workspaces.active} active · ${stats.workspaces.suspended} suspended`}
              trend={`+${stats.workspaces.newThisMonth} this month`}
            />
            <KpiCard
              icon={Users} label="Platform Users" iconColor="bg-blue-500" accentColor="text-blue-600 bg-blue-50 border-blue-100"
              value={stats.users.total}
              sub={`${stats.users.active} active`}
              trend={`${stats.users.total > 0 ? Math.round((stats.users.active / stats.users.total) * 100) : 0}% active rate`}
            />
            <KpiCard
              icon={MessageSquare} label="Messages (7 days)" iconColor="bg-teal-500" accentColor="text-teal-600 bg-teal-50 border-teal-100"
              value={msgTotal7d}
              sub={`${stats.messages.today.toLocaleString()} today`}
              trend={`+${wsNew7d} new ws`}
            />
            <KpiCard
              icon={Radio} label="Active Channels" iconColor="bg-violet-500" accentColor="text-violet-600 bg-violet-50 border-violet-100"
              value={stats.channels.active}
              sub={`of ${stats.channels.total} total`}
              trend={`${stats.channels.total > 0 ? Math.round((stats.channels.active / stats.channels.total) * 100) : 0}% active`}
            />
          </div>

          {/* KPI Row 2 */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard
              icon={Activity} label="Open Conversations" iconColor="bg-sky-500" accentColor="text-sky-600 bg-sky-50 border-sky-100"
              value={stats.conversations.open}
              sub={`of ${stats.conversations.total.toLocaleString()} total`}
            />
            <KpiCard
              icon={Megaphone} label="Campaigns Sent" iconColor="bg-orange-500" accentColor="text-orange-600 bg-orange-50 border-orange-100"
              value={stats.campaigns.sent.toLocaleString()}
              sub={`${stats.campaigns.total} total campaigns`}
              trend={deliveryRate > 0 ? `${deliveryRate}% delivered` : undefined}
            />
            <KpiCard
              icon={Contact} label="Total Contacts" iconColor="bg-pink-500" accentColor="text-pink-600 bg-pink-50 border-pink-100"
              value={stats.contacts.total.toLocaleString()}
              sub="across all workspaces"
            />
            <KpiCard
              icon={TrendingUp} label="Campaign Read Rate" iconColor="bg-emerald-500" accentColor="text-emerald-600 bg-emerald-50 border-emerald-100"
              value={stats.campaigns.sent > 0 ? `${Math.round((stats.campaigns.read / stats.campaigns.sent) * 100)}%` : '—'}
              sub={`${stats.campaigns.read.toLocaleString()} reads`}
            />
          </div>

          {/* Charts */}
          {analytics && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Message Volume */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-slate-800 text-sm font-bold">Message Volume</h2>
                    <p className="text-slate-400 text-xs mt-0.5">Daily messages over the last 7 days</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-900 text-lg font-bold">{msgTotal7d.toLocaleString()}</p>
                    <p className="text-slate-400 text-[11px]">total</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={analytics.messageVolume} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#475569' }} />
                    <Area type="monotone" dataKey="count" stroke="#14b8a6" strokeWidth={2} fill="url(#msgGrad)" name="Messages" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Workspace Growth */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-slate-800 text-sm font-bold">New Workspaces</h2>
                    <p className="text-slate-400 text-xs mt-0.5">Daily registrations over the last 7 days</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-900 text-lg font-bold">{wsNew7d}</p>
                    <p className="text-slate-400 text-[11px]">registered</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={analytics.workspaceGrowth} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#475569' }} />
                    <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} name="Workspaces" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Bottom row */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Recent activity */}
            <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-slate-800 text-sm font-bold">Recent Activity</h2>
                <a href="/platform-admin/audit" className="text-indigo-600 text-xs font-medium hover:underline">View all →</a>
              </div>
              {auditLogs.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-slate-400 text-sm">No recent events</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50/50 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-[10px] font-bold flex-shrink-0">
                        {log.admin?.name?.slice(0, 2).toUpperCase() ?? 'SY'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full border', ACTION_COLORS[log.action] ?? 'text-slate-500 bg-slate-50 border-slate-200')}>
                            {log.action.replace(/_/g, ' ')}
                          </span>
                          <span className="text-slate-600 text-xs truncate">{log.admin?.email ?? 'System'}</span>
                        </div>
                        {log.metadata && typeof log.metadata['name'] === 'string' && (
                          <p className="text-slate-400 text-[10px] mt-0.5 italic truncate">"{log.metadata['name'] as string}"</p>
                        )}
                      </div>
                      <span className="text-slate-400 text-[10px] flex-shrink-0">{relativeTime(log.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right column: Plan distribution + platform health */}
            <div className="flex flex-col gap-4">
              {/* Plan distribution */}
              {analytics && analytics.planDistribution.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h2 className="text-slate-800 text-sm font-bold mb-1">Plan Distribution</h2>
                  <p className="text-slate-400 text-[11px] mb-4">{analytics.planDistribution.reduce((s, d) => s + d.count, 0)} workspaces</p>
                  <ResponsiveContainer width="100%" height={120}>
                    <PieChart>
                      <Pie data={analytics.planDistribution} dataKey="count" nameKey="plan" cx="50%" cy="50%" innerRadius={32} outerRadius={52} paddingAngle={2}>
                        {analytics.planDistribution.map((entry, index) => (
                          <Cell key={entry.plan} fill={PLAN_COLORS[entry.plan] ?? ['#6366f1', '#8b5cf6', '#a78bfa'][index % 3]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {analytics.planDistribution.map((entry, index) => (
                      <div key={entry.plan} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PLAN_COLORS[entry.plan] ?? ['#6366f1', '#8b5cf6', '#a78bfa'][index % 3] }} />
                          <span className="text-slate-600 text-[11px] uppercase font-medium">{entry.plan}</span>
                        </div>
                        <span className="text-slate-700 text-[11px] font-bold">{entry.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Platform health */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="text-slate-800 text-sm font-bold mb-4">Platform Health</h2>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={13} className="text-slate-400" />
                      <span className="text-slate-700 text-xs font-medium">Registrations</span>
                    </div>
                    {registrationOn ? (
                      <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                        <CheckCircle2 size={8} /> Open
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-600 text-[10px] font-bold bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                        <AlertCircle size={8} /> Closed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2">
                      <Wrench size={13} className="text-slate-400" />
                      <span className="text-slate-700 text-xs font-medium">Maintenance</span>
                    </div>
                    {maintenanceOn ? (
                      <span className="flex items-center gap-1 text-amber-600 text-[10px] font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                        <AlertCircle size={8} /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                        <CheckCircle2 size={8} /> Normal
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-slate-400" />
                      <span className="text-slate-700 text-xs font-medium">AI Features</span>
                    </div>
                    {aiEnabled ? (
                      <span className="flex items-center gap-1 text-indigo-600 text-[10px] font-bold bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                        <CheckCircle2 size={8} /> On
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[10px] font-bold bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">Off</span>
                    )}
                  </div>
                  {stats.campaigns.sent > 0 && (
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-slate-700 text-xs font-medium">Campaign Delivery</span>
                        <span className="text-slate-700 text-xs font-bold">{deliveryRate}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', deliveryRate >= 80 ? 'bg-emerald-500' : deliveryRate >= 60 ? 'bg-amber-500' : 'bg-red-500')}
                          style={{ width: `${deliveryRate}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
