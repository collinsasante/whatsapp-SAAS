'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Database, Cpu, CreditCard, Activity, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { adminApi, type PlatformHealthData } from '@/lib/admin-api';
import { Panel } from '@/components/admin/Panel';
import { Badge } from '@/components/admin/Badge';

export default function SystemHealthPage() {
  const [health, setHealth] = useState<PlatformHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await adminApi.platformHealth());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
        <p className="text-gray-500 text-sm mt-1">Real infrastructure signals — no synthetic uptime numbers</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {health && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Panel title="Database" icon={Database}>
              <div className="flex items-center justify-between">
                <Badge tone={health.dbPing.reachable ? 'success' : 'danger'}>{health.dbPing.reachable ? 'Reachable' : 'Unreachable'}</Badge>
                {health.dbPing.latencyMs != null && <span className="text-sm text-gray-500">{health.dbPing.latencyMs}ms</span>}
              </div>
            </Panel>
            <Panel title="AI Provider" icon={Cpu}>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Configured</span><Badge tone={health.aiProvider.configured ? 'success' : 'warning'}>{health.aiProvider.configured ? 'Yes' : 'No'}</Badge></div>
                <div className="flex justify-between"><span className="text-gray-500">Last success</span><span>{health.aiProvider.lastSuccessfulCallAt ? new Date(health.aiProvider.lastSuccessfulCallAt).toLocaleString() : 'Never'}</span></div>
              </div>
            </Panel>
            <Panel title="Payment Gateways" icon={CreditCard}>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Stripe</span><Badge tone={health.paymentGateway.stripeConfigured ? 'success' : 'neutral'}>{health.paymentGateway.stripeConfigured ? 'Configured' : 'Not set'}</Badge></div>
                <div className="flex justify-between"><span className="text-gray-500">Paystack</span><Badge tone={health.paymentGateway.paystackConfigured ? 'success' : 'neutral'}>{health.paymentGateway.paystackConfigured ? 'Configured' : 'Not set'}</Badge></div>
                <div className="flex justify-between"><span className="text-gray-500">Last success</span><span>{health.paymentGateway.lastSuccessfulPaymentAt ? new Date(health.paymentGateway.lastSuccessfulPaymentAt).toLocaleString() : 'Never'}</span></div>
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Panel title="Error rate (30 days)" icon={Activity}>
              {health.errorRateTrend.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No message activity in this window</div>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={health.errorRateTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="errorRatePct" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="WhatsApp quality" icon={Activity}>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div><div className="text-xl font-bold text-emerald-600">{health.whatsappQuality.GREEN}</div><div className="text-xs text-gray-400">Green</div></div>
                <div><div className="text-xl font-bold text-amber-600">{health.whatsappQuality.YELLOW}</div><div className="text-xs text-gray-400">Yellow</div></div>
                <div><div className="text-xl font-bold text-red-600">{health.whatsappQuality.RED}</div><div className="text-xs text-gray-400">Red</div></div>
                <div><div className="text-xl font-bold text-gray-400">{health.whatsappQuality.UNKNOWN}</div><div className="text-xs text-gray-400">Unknown</div></div>
              </div>
            </Panel>
          </div>

          <Panel title="Directional gross-margin estimate per tenant (30d)" icon={Activity} className="mb-6">
            <p className="text-xs text-gray-400 mb-3">Estimated Meta conversation cost vs. revenue — directional only, not real cost accounting. Worst margin first.</p>
            <div className="space-y-1.5 max-h-64 overflow-auto">
              {health.costEstimatePerTenant.length === 0 && <div className="text-sm text-gray-400 text-center py-4">No data</div>}
              {health.costEstimatePerTenant.map((t) => (
                <Link key={t.tenantId} href={`/platform-admin/workspaces/${t.tenantId}`} className="flex items-center justify-between text-sm hover:bg-gray-50 rounded px-1 py-1 -mx-1">
                  <span className="text-gray-700 hover:text-teal-600 hover:underline truncate">{t.tenantName}</span>
                  <span className={t.estimatedGrossMargin < 0 ? 'text-red-600' : 'text-emerald-600'}>${t.estimatedGrossMargin.toFixed(2)}</span>
                </Link>
              ))}
            </div>
          </Panel>

          {health.notInstrumented.length > 0 && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 text-xs">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              Not yet instrumented, shown honestly rather than faked: {health.notInstrumented.join(', ')}.
            </div>
          )}
        </>
      )}

      {loading && !health && <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>}
    </div>
  );
}
