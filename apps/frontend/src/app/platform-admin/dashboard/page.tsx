'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2, Users, MessageSquare, DollarSign, TrendingUp, TrendingDown, Clock, CreditCard, AlertCircle,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { adminApi, type AdminStats, type OverviewData } from '@/lib/admin-api';
import { useAutoRefresh } from '../_hooks/useAutoRefresh';
import { LiveBadge } from '../_components/LiveBadge';

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-sm text-gray-500 font-medium">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function OverviewCard({ label, value, changePct, tooltip, trend }: {
  label: string; value: string; changePct?: number | null; tooltip: string; trend?: { date: string; amountGhs: number }[];
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5" title={tooltip}>
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {changePct != null && (
        <div className={`flex items-center gap-1 text-xs font-medium mt-1 ${changePct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {changePct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(changePct)}% vs previous period
        </div>
      )}
      {trend && trend.length > 1 && (
        <div className="h-10 mt-2 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="mrrSparkline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                formatter={(v) => [`GHS ${Number(v).toFixed(2)}`, 'MRR']}
                contentStyle={{ fontSize: 11, padding: '4px 8px' }}
              />
              <Area type="monotone" dataKey="amountGhs" stroke="#0d9488" strokeWidth={1.5} fill="url(#mrrSparkline)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

const MOVEMENT_META: Record<string, { label: string; color: string }> = {
  NEW: { label: 'New', color: 'text-emerald-600' },
  EXPANSION: { label: 'Expansion', color: 'text-teal-600' },
  CONTRACTION: { label: 'Contraction', color: 'text-amber-600' },
  CHURNED: { label: 'Churned', color: 'text-red-600' },
};

function MrrMovementStrip({ movement }: { movement: OverviewData['mrrMovement'] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="text-sm font-semibold text-gray-900 mb-3">MRR movement this period</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['NEW', 'EXPANSION', 'CONTRACTION', 'CHURNED'] as const).map((cat) => {
          const meta = MOVEMENT_META[cat]!;
          const bucket = movement[cat];
          return (
            <button
              key={cat}
              onClick={() => setExpanded(expanded === cat ? null : cat)}
              className="text-left p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                {bucket.count > 0 && (expanded === cat ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />)}
              </div>
              <div className="text-lg font-bold text-gray-900 mt-0.5">{bucket.count}</div>
              <div className="text-[10px] text-gray-400">GHS {bucket.amountGhs.toFixed(2)}</div>
            </button>
          );
        })}
      </div>
      {expanded && movement[expanded as keyof OverviewData['mrrMovement']].tenants.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-1.5">
          {movement[expanded as keyof OverviewData['mrrMovement']].tenants.map((t) => (
            <Link
              key={`${t.tenantId}-${t.date}`}
              href={`/platform-admin/workspaces/${t.tenantId}`}
              className="flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-gray-50"
            >
              <span className="text-gray-700 font-medium hover:text-teal-600 hover:underline">{t.tenantName}</span>
              <span className="text-gray-400">GHS {t.mrrGhs.toFixed(2)} · {t.date}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [dashData, overviewData] = await Promise.all([adminApi.dashboard(), adminApi.overview()]);
      setStats(dashData);
      setOverview(overviewData);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const { secondsAgo, refresh } = useAutoRefresh(load);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Platform overview</p>
        </div>
        <LiveBadge secondsAgo={secondsAgo} onRefresh={refresh} refreshing={refreshing} />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 h-24 animate-pulse bg-gray-50" />
          ))}
        </div>
      ) : (
        <>
          {overview && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <OverviewCard
                  label="MRR" value={`GHS ${overview.mrr.amountGhs.toFixed(2)}`}
                  changePct={overview.mrr.changePct} trend={overview.mrr.trend}
                  tooltip="Monthly recurring revenue, normalized to GHS, as of the most recent daily rollup"
                />
                <OverviewCard
                  label="ARR" value={`GHS ${overview.arrGhs.toFixed(2)}`}
                  tooltip="Annualized run rate (MRR × 12)"
                />
                <OverviewCard
                  label="Net revenue retention"
                  value={overview.netRevenueRetention != null ? `${overview.netRevenueRetention}%` : '—'}
                  tooltip="Of tenants paying at the start of the period, what % of their combined MRR remains today (including expansion/contraction, excluding new tenants). Above 100% means expansion outpaced churn."
                />
                <OverviewCard
                  label="Logo churn rate"
                  value={overview.logoChurnRate != null ? `${overview.logoChurnRate}%` : '—'}
                  tooltip="% of tenants paying at the start of the period who had churned by the end"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <OverviewCard label="Active paying tenants" value={String(overview.activePayingTenants)} tooltip="Tenants with an ACTIVE subscription, as of the most recent daily rollup" />
                <OverviewCard label="Trials in progress" value={String(overview.trialsInProgress)} tooltip="Tenants currently on a TRIAL subscription" />
                <OverviewCard
                  label="Trial → paid conversion"
                  value={overview.trialToPaidConversionRate != null ? `${overview.trialToPaidConversionRate}%` : '—'}
                  tooltip="Of trials that resolved (converted or still trialing) in this period, what % converted to paid"
                />
                <OverviewCard label="ARPU" value={`GHS ${overview.arpuGhs.toFixed(2)}`} tooltip="Average revenue per paying tenant (MRR ÷ active paying tenants)" />
              </div>
              <div className="mb-6">
                <MrrMovementStrip movement={overview.mrrMovement} />
              </div>
            </>
          )}

          {stats && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <StatCard icon={Building2} label="Total Workspaces" value={stats.totalTenants} color="bg-teal-500" />
                <StatCard icon={TrendingUp} label="Active Subscriptions" value={stats.activeSubs} sub={`${stats.trialSubs} on trial`} color="bg-blue-500" />
                <StatCard icon={Users} label="Total Users" value={stats.totalUsers.toLocaleString()} color="bg-violet-500" />
                <StatCard icon={MessageSquare} label="Total Messages" value={stats.totalMessages.toLocaleString()} color="bg-orange-500" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={DollarSign} label="Revenue This Month" value={`$${stats.monthlyRevenue.toLocaleString()}`} color="bg-emerald-500" />
                <StatCard icon={Clock} label="Pending Invoices" value={stats.pendingInvoices} sub="awaiting payment" color={stats.pendingInvoices > 0 ? 'bg-amber-500' : 'bg-gray-400'} />
                <StatCard icon={CreditCard} label="Pending Credit Orders" value={stats.pendingCredits} sub="awaiting activation" color={stats.pendingCredits > 0 ? 'bg-amber-500' : 'bg-gray-400'} />
                <StatCard icon={TrendingUp} label="Trial Workspaces" value={stats.trialSubs} color="bg-sky-500" />
              </div>

              {(stats.pendingInvoices > 0 || stats.pendingCredits > 0) && (
                <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Payments waiting for activation</p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      {stats.pendingInvoices} invoice{stats.pendingInvoices !== 1 ? 's' : ''} and {stats.pendingCredits} credit order{stats.pendingCredits !== 1 ? 's' : ''} need your action.{' '}
                      <a href="/platform-admin/billing" className="underline font-medium">Go to Billing →</a>
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
