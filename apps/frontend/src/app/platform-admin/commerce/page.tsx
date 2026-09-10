'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, DollarSign, TrendingDown, TrendingUp, Percent } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { adminApi, type CommerceAnalyticsData } from '@/lib/admin-api';
import { KpiCard } from '@/components/admin/KpiCard';
import { Panel } from '@/components/admin/Panel';
import { DateRangePicker, rangeForPreset } from '@/components/admin/DateRangePicker';

export default function CommerceRevenuePage() {
  const [data, setData] = useState<CommerceAnalyticsData | null>(null);
  const [range, setRange] = useState(rangeForPreset('30d', '', ''));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (r: { from: string; to: string }) => {
    setLoading(true);
    try {
      setData(await adminApi.commerceAnalytics(r.from, r.to));
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
          <h1 className="text-2xl font-bold text-gray-900">Commerce Revenue</h1>
          <p className="text-gray-500 text-sm mt-1">GMV, fees, and refunds across managed commerce</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label="GMV" value={`GHS ${data.totals.gmv.toLocaleString()}`} icon={DollarSign} color="bg-teal-600" />
            <KpiCard label="Fee Revenue" value={`GHS ${data.totals.fees.toLocaleString()}`} icon={Percent} color="bg-emerald-600" />
            <KpiCard label="Refunds" value={`GHS ${data.totals.refunds.toLocaleString()}`} icon={TrendingDown} color="bg-red-500" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Daily GMV" icon={TrendingUp} className="lg:col-span-2">
              {data.daily.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No commerce activity in this period</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.daily}>
                      <defs>
                        <linearGradient id="gmvGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="gmv" stroke="#0d9488" fill="url(#gmvGradient)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="Top tenants by GMV" icon={DollarSign}>
              <div className="space-y-2">
                {data.topTenants.length === 0 && <div className="text-sm text-gray-400 text-center py-4">No data</div>}
                {data.topTenants.map((t) => (
                  <Link key={t.tenantId} href={`/platform-admin/workspaces/${t.tenantId}`} className="flex items-center justify-between text-sm hover:bg-gray-50 rounded px-1 py-0.5 -mx-1">
                    <span className="text-gray-700 font-medium hover:text-teal-600 hover:underline truncate">{t.tenantName}</span>
                    <span className="text-gray-500 shrink-0 ml-2">GHS {t.gmv.toLocaleString()}</span>
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
