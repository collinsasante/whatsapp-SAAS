'use client';
import { useEffect, useState } from 'react';
import {
  Building2, Users, MessageSquare, Radio,
  TrendingUp, Inbox, Megaphone, Zap,
} from 'lucide-react';
import { adminDashboardApi } from '@/lib/admin-api';

interface Stats {
  workspaces: { total: number; active: number; suspended: number; newThisMonth: number };
  users: { total: number; active: number };
  conversations: { total: number; open: number };
  messages: { total: number; today: number };
  channels: { total: number; active: number };
  campaigns: { total: number; sent: number; delivered: number; read: number; failed: number };
  contacts: { total: number };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent ?? 'bg-slate-800'}`}>
          <Icon size={15} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-sm text-slate-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminDashboardApi.stats()
      .then((r) => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const deliveryRate = stats
    ? stats.campaigns.sent > 0
      ? Math.round((stats.campaigns.delivered / stats.campaigns.sent) * 100)
      : 0
    : 0;

  const readRate = stats
    ? stats.campaigns.delivered > 0
      ? Math.round((stats.campaigns.read / stats.campaigns.delivered) * 100)
      : 0
    : 0;

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">Live counts across all workspaces.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="w-4 h-4 border-2 border-slate-600 border-t-[#25D366] rounded-full animate-spin" />
          Loading stats...
        </div>
      ) : stats ? (
        <div className="space-y-6">
          {/* Row 1 — Workspaces + Users */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Workspaces & members</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={Building2}
                label="Total workspaces"
                value={fmt(stats.workspaces.total)}
                sub={`${stats.workspaces.suspended} suspended`}
                accent="bg-violet-600"
              />
              <StatCard
                icon={TrendingUp}
                label="New this month"
                value={`+${stats.workspaces.newThisMonth}`}
                sub={`${stats.workspaces.active} active`}
                accent="bg-emerald-600"
              />
              <StatCard
                icon={Users}
                label="Total members"
                value={fmt(stats.users.total)}
                sub={`${fmt(stats.users.active)} active`}
                accent="bg-blue-600"
              />
              <StatCard
                icon={Radio}
                label="Connected channels"
                value={stats.channels.active}
                sub={`${stats.channels.total} total`}
                accent="bg-[#25D366]"
              />
            </div>
          </div>

          {/* Row 2 — Messages + Conversations */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Message activity</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={MessageSquare}
                label="Messages today"
                value={fmt(stats.messages.today)}
                sub={`${fmt(stats.messages.total)} all time`}
                accent="bg-[#25D366]"
              />
              <StatCard
                icon={Inbox}
                label="Open conversations"
                value={fmt(stats.conversations.open)}
                sub={`${fmt(stats.conversations.total)} total`}
                accent="bg-orange-500"
              />
              <StatCard
                icon={Zap}
                label="Total contacts"
                value={fmt(stats.contacts.total)}
                accent="bg-slate-700"
              />
              <StatCard
                icon={Megaphone}
                label="Campaigns run"
                value={stats.campaigns.total}
                accent="bg-pink-600"
              />
            </div>
          </div>

          {/* Row 3 — Campaign health */}
          {stats.campaigns.total > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Campaign delivery health</p>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  <div>
                    <p className="text-2xl font-bold text-white tabular-nums">{fmt(stats.campaigns.sent)}</p>
                    <p className="text-sm text-slate-400 mt-0.5">Sent</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-[#25D366] tabular-nums">{deliveryRate}%</p>
                    <p className="text-sm text-slate-400 mt-0.5">Delivery rate</p>
                    <p className="text-xs text-slate-600">{fmt(stats.campaigns.delivered)} delivered</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-400 tabular-nums">{readRate}%</p>
                    <p className="text-sm text-slate-400 mt-0.5">Read rate</p>
                    <p className="text-xs text-slate-600">{fmt(stats.campaigns.read)} read</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-400 tabular-nums">{fmt(stats.campaigns.failed)}</p>
                    <p className="text-sm text-slate-400 mt-0.5">Failed sends</p>
                  </div>
                </div>
                {stats.campaigns.sent > 0 && (
                  <div className="mt-4">
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#25D366] rounded-full"
                        style={{ width: `${deliveryRate}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">Delivery rate across all campaigns</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-slate-500 text-sm">Failed to load stats.</p>
      )}
    </div>
  );
}
