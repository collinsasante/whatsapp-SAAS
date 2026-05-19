'use client';
import { useEffect, useState } from 'react';
import { Building2, Users, MessageSquare, Megaphone, Phone, TrendingUp, Activity, RefreshCw } from 'lucide-react';
import { platformAdminApi, type DashboardStats } from '@/lib/platform-admin-api';

function StatCard({ icon: Icon, label, value, sub, color = 'teal' }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colors: Record<string, string> = {
    teal:   'bg-teal-500/10 text-teal-400 border-teal-500/20',
    blue:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    green:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rose:   'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };
  return (
    <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 hover:border-white/15 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${colors[color]}`}>
          <Icon size={16} />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      <p className="text-sm text-slate-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await platformAdminApi.getStats();
      setStats(res.data);
      setError('');
    } catch {
      setError('Failed to load stats');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="p-6 lg:p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">Platform overview</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl text-slate-400 hover:text-white text-sm transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 h-28 animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard icon={Building2}    label="Total Workspaces"  value={stats.workspaces.total}         sub={`${stats.workspaces.active} active`}              color="teal" />
            <StatCard icon={TrendingUp}   label="New This Month"    value={stats.workspaces.newThisMonth}  sub={`${stats.workspaces.suspended} suspended`}        color="green" />
            <StatCard icon={Users}        label="Total Users"       value={stats.users.total}              sub={`${stats.users.active} active`}                   color="blue" />
            <StatCard icon={Phone}        label="Active Channels"   value={stats.channels.active}          sub={`${stats.channels.total} total`}                  color="purple" />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard icon={MessageSquare} label="Total Conversations" value={stats.conversations.total}  sub={`${stats.conversations.open} open`}               color="orange" />
            <StatCard icon={Activity}      label="Messages Today"      value={stats.messages.today}       sub={`${stats.messages.total.toLocaleString()} total`} color="rose" />
            <StatCard icon={Megaphone}     label="Campaigns"           value={stats.campaigns.total}      sub={`${stats.campaigns.sent.toLocaleString()} sent`}  color="teal" />
            <StatCard icon={Users}         label="Contacts"            value={stats.contacts.total}       color="blue" />
          </div>

          {/* Campaign delivery stats */}
          <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-6">
            <h2 className="text-white font-semibold text-base mb-5">Campaign Delivery</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {[
                { label: 'Sent',      val: stats.campaigns.sent,      color: 'bg-teal-500' },
                { label: 'Delivered', val: stats.campaigns.delivered, color: 'bg-blue-500' },
                { label: 'Read',      val: stats.campaigns.read,      color: 'bg-emerald-500' },
                { label: 'Failed',    val: stats.campaigns.failed,    color: 'bg-red-500' },
              ].map(({ label, val, color }) => {
                const pct = stats.campaigns.sent > 0 ? Math.round((val / stats.campaigns.sent) * 100) : 0;
                return (
                  <div key={label}>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-slate-400 text-xs">{label}</span>
                      <span className="text-white text-sm font-semibold">{val.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 bg-white/6 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-slate-600 text-xs mt-1">{pct}%</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
