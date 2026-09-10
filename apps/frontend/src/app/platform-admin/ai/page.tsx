'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Zap, DollarSign, TrendingUp, PhoneCall } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { adminApi, type AiAnalyticsData } from '@/lib/admin-api';
import { KpiCard } from '@/components/admin/KpiCard';
import { Panel } from '@/components/admin/Panel';
import { DateRangePicker, rangeForPreset } from '@/components/admin/DateRangePicker';

export default function AiOverviewPage() {
  const [data, setData] = useState<AiAnalyticsData | null>(null);
  const [range, setRange] = useState(rangeForPreset('30d', '', ''));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (r: { from: string; to: string }) => {
    setLoading(true);
    try {
      const res = await adminApi.aiAnalytics(r.from, r.to);
      setData(res);
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
          <h1 className="text-2xl font-bold text-gray-900">Verz AI Overview</h1>
          <p className="text-gray-500 text-sm mt-1">AI usage, cost, and revenue across every tenant</p>
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
            <KpiCard label="AI Calls" value={data.totals.calls.toLocaleString()} icon={PhoneCall} color="bg-teal-600" />
            <KpiCard label="AI Cost (USD)" value={`$${data.totals.costUsd.toFixed(2)}`} icon={DollarSign} color="bg-amber-500" />
            <KpiCard label="Credit Revenue (USD)" value={`$${data.totals.revenueUsd.toFixed(2)}`} icon={Zap} color="bg-emerald-600" />
            <KpiCard label="Margin (USD)" value={`$${data.totals.marginUsd.toFixed(2)}`} icon={TrendingUp} color={data.totals.marginUsd >= 0 ? 'bg-emerald-600' : 'bg-red-500'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Daily AI calls & cost" icon={TrendingUp} className="lg:col-span-2">
              {data.daily.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No AI activity in this period</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="calls" fill="#0d9488" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="By provider" icon={Zap}>
              <div className="space-y-2">
                {data.byProvider.length === 0 && <div className="text-sm text-gray-400 text-center py-4">No data</div>}
                {data.byProvider.map((p) => (
                  <div key={p.provider} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 font-medium">{p.provider}</span>
                    <span className="text-gray-500">{p.calls} calls · ${p.costUsd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="By model" icon={Zap} className="lg:col-span-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.byModel.length === 0 && <div className="text-sm text-gray-400 text-center py-4 col-span-full">No data</div>}
                {data.byModel.map((m) => (
                  <div key={`${m.provider}-${m.modelKey}`} className="bg-gray-50 rounded-lg p-3 text-sm">
                    <div className="font-medium text-gray-900">{m.modelKey}</div>
                    <div className="text-gray-400 text-xs">{m.provider}</div>
                    <div className="text-gray-500 mt-1">{m.calls} calls · ${m.costUsd.toFixed(2)}</div>
                  </div>
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
