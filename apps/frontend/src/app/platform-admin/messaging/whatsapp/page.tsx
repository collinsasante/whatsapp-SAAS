'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Smartphone, Info } from 'lucide-react';
import { adminApi, type PlatformHealthData } from '@/lib/admin-api';
import { KpiCard } from '@/components/admin/KpiCard';
import { Panel } from '@/components/admin/Panel';

export default function WhatsAppAccountsPage() {
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
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp Accounts</h1>
        <p className="text-gray-500 text-sm mt-1">Quality-rating distribution across every connected WhatsApp number</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {health && (
        <Panel title="Quality rating distribution" icon={Smartphone}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard label="Total numbers" value={health.whatsappQuality.total} compact />
            <KpiCard label="Green" value={health.whatsappQuality.GREEN} compact />
            <KpiCard label="Yellow" value={health.whatsappQuality.YELLOW} compact />
            <KpiCard label="Red" value={health.whatsappQuality.RED} compact />
          </div>
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-3 py-2 mt-4 text-xs">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            A per-number cross-tenant directory (which tenant owns which number, sync history) isn&apos;t built yet — this
            page shows the real aggregate quality distribution only. See each tenant&apos;s detail page for its own numbers.
          </div>
        </Panel>
      )}

      {loading && !health && <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>}
    </div>
  );
}
