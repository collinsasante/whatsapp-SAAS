'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Send, CheckCircle2, XCircle, Inbox } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { adminApi, type MessagingAnalyticsData } from '@/lib/admin-api';
import { KpiCard } from '@/components/admin/KpiCard';
import { Panel } from '@/components/admin/Panel';
import { DateRangePicker, rangeForPreset } from '@/components/admin/DateRangePicker';

export default function MessagingPage() {
  const [data, setData] = useState<MessagingAnalyticsData | null>(null);
  const [range, setRange] = useState(rangeForPreset('30d', '', ''));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (r: { from: string; to: string }) => {
    setLoading(true);
    try {
      setData(await adminApi.messagingAnalytics(r.from, r.to));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range); }, [load, range]);

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Messages & Delivery</h1>
          <p className="text-gray-500 text-sm mt-1">Cross-tenant WhatsApp delivery performance</p>
        </div>
        <DateRangePicker onChange={setRange} />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Sent" value={data.totals.sent.toLocaleString()} icon={Send} color="bg-teal-600" />
            <KpiCard label="Delivered" value={data.totals.delivered.toLocaleString()} icon={CheckCircle2} color="bg-emerald-600" />
            <KpiCard label="Failed" value={data.totals.failed.toLocaleString()} icon={XCircle} color="bg-red-500" />
            <KpiCard label="Inbound" value={data.totals.inbound.toLocaleString()} icon={Inbox} color="bg-blue-500" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Daily volume" icon={Send} className="lg:col-span-2">
              {data.daily.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No message activity in this period</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="sent" stroke="#0d9488" fill="#0d9488" fillOpacity={0.15} strokeWidth={2} />
                      <Area type="monotone" dataKey="failed" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="Top failing tenants" icon={XCircle}>
              <div className="space-y-2">
                {data.topFailingTenants.length === 0 && <div className="text-sm text-gray-400 text-center py-4">No tenants with meaningful failure volume</div>}
                {data.topFailingTenants.map((t) => (
                  <Link key={t.tenantId} href={`/platform-admin/workspaces/${t.tenantId}`} className="flex items-center justify-between text-sm hover:bg-gray-50 rounded px-1 py-0.5 -mx-1">
                    <span className="text-gray-700 font-medium hover:text-teal-600 hover:underline truncate">{t.tenantName}</span>
                    <span className="text-red-500 shrink-0 ml-2">{t.errorRatePct}%</span>
                  </Link>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}

      {loading && !data && <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>}
    </div>
  );
}
