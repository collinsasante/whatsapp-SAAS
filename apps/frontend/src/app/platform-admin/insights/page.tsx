'use client';
import { useCallback, useEffect, useState } from 'react';
import { Filter, Users, Layers, BarChart3 } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { adminApi, type FunnelData, type UsageData } from '@/lib/admin-api';
import { useAutoRefresh } from '../_hooks/useAutoRefresh';
import { LiveBadge } from '../_components/LiveBadge';

const STAGE_LABELS: Record<string, string> = {
  signed_up: 'Signed up',
  whatsapp_connected: 'WhatsApp connected',
  template_approved: 'Template approved',
  first_engagement: 'First engagement',
  team_invited: 'Team invited',
  converted_paid: 'Converted to paid',
  active_last_7_days: 'Active & paying',
};

const FEATURE_LABELS: Record<string, string> = {
  broadcasts: 'Broadcasts', templates: 'Templates', tags: 'Tags',
  assignments: 'Assignments', automations: 'Automations', payments: 'Payments',
};

function Panel({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-teal-600" />
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

export default function InsightsPage() {
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [funnelRes, usageRes] = await Promise.all([adminApi.funnel(), adminApi.usage()]);
      setFunnel(funnelRes);
      setUsage(usageRes);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const { secondsAgo, refresh } = useAutoRefresh(load);

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Insights</h1>
          <p className="text-gray-500 text-sm mt-1">Where onboarding leaks, and what tenants actually use</p>
        </div>
        <LiveBadge secondsAgo={secondsAgo} onRefresh={refresh} refreshing={refreshing} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 h-64 animate-pulse bg-gray-50" />)}
        </div>
      ) : (
        <>
          <Panel title="Tenant lifecycle funnel" icon={Filter}>
            {!funnel || funnel.cohortSize === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">No tenants signed up in this period</p>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-3">{funnel.cohortSize} tenant{funnel.cohortSize !== 1 ? 's' : ''} signed up in this period</p>
                <div className="space-y-2">
                  {funnel.stages.map((s) => (
                    <div key={s.stage}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-gray-700">{STAGE_LABELS[s.stage] ?? s.stage}</span>
                        <span className="text-gray-500">
                          {s.count} {s.conversionFromPrevPct != null && <span className="text-gray-400">({s.conversionFromPrevPct}% from prior stage)</span>}
                        </span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${funnel.cohortSize > 0 ? (s.count / funnel.cohortSize) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>

          {usage && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Messages sent" value={usage.totals.messagesSent.toLocaleString()} />
                <StatCard label="Messages received" value={usage.totals.messagesReceived.toLocaleString()} />
                <StatCard label="New conversations" value={usage.totals.newConversations.toLocaleString()} />
                <StatCard label="Resolved" value={usage.totals.resolvedConversations.toLocaleString()} />
                <StatCard label="Broadcasts sent" value={usage.totals.broadcastsSent.toLocaleString()} />
                <StatCard label="Templates created" value={usage.totals.templatesCreated.toLocaleString()} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Panel title="DAU / WAU / MAU" icon={Users}>
                  {usage.stickinessRatio != null && (
                    <p className="text-xs text-gray-500 mb-3">Stickiness (DAU/MAU): <span className="font-semibold text-teal-600">{usage.stickinessRatio}%</span></p>
                  )}
                  {usage.dauWauMauTrend.length === 0 ? (
                    <p className="text-xs text-gray-400 py-10 text-center">No login activity data in this period</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={usage.dauWauMauTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="dau" name="DAU" stroke="#0d9488" strokeWidth={1.5} dot={false} />
                        <Line type="monotone" dataKey="wau" name="WAU" stroke="#6366f1" strokeWidth={1.5} dot={false} />
                        <Line type="monotone" dataKey="mau" name="MAU" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Panel>

                <Panel title="Feature adoption (active tenants)" icon={Layers}>
                  <div className="space-y-2.5">
                    {usage.featureAdoption.map((f) => (
                      <div key={f.feature}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-gray-700">{FEATURE_LABELS[f.feature] ?? f.feature}</span>
                          <span className="text-gray-500">{f.adoptionPct}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${f.adoptionPct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>

              <Panel title="Power-user distribution (weekly message volume)" icon={BarChart3}>
                <p className="text-xs text-gray-400 mb-3">Are we growing from many small tenants, or a few big ones?</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={usage.powerUserHistogram}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => [`${v} tenants`, 'Count']} />
                    <Bar dataKey="tenantCount" radius={[4, 4, 0, 0]}>
                      {usage.powerUserHistogram.map((_, i) => <Cell key={i} fill={['#e2e8f0', '#a5b4fc', '#818cf8', '#6366f1', '#4338ca'][i] ?? '#6366f1'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
