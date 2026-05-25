'use client';
import { useEffect, useState } from 'react';
import { Building2, Users, MessageSquare, DollarSign, TrendingUp, Clock, CreditCard, AlertCircle } from 'lucide-react';
import { adminApi, type AdminStats } from '@/lib/admin-api';

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

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.dashboard()
      .then(setStats)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Platform overview</p>
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
      ) : stats && (
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
    </div>
  );
}
