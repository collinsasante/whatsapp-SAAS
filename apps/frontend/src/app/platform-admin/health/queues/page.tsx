'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { adminApi, type PlatformHealthData } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Badge } from '@/components/admin/Badge';

type QueueRow = PlatformHealthData['queueHealth'][number];

export default function QueuesPage() {
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

  const columns: DataTableColumn<QueueRow>[] = [
    { key: 'name', header: 'Queue', render: (r) => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: 'reachable', header: 'Status', render: (r) => <Badge tone={r.reachable ? 'success' : 'danger'}>{r.reachable ? 'Reachable' : 'Unreachable'}</Badge> },
    { key: 'waiting', header: 'Waiting', render: (r) => r.waiting },
    { key: 'active', header: 'Active', render: (r) => r.active },
    { key: 'completed', header: 'Completed', render: (r) => r.completed },
    { key: 'failed', header: 'Failed', render: (r) => <span className={r.failed > 0 ? 'text-red-600 font-medium' : ''}>{r.failed}</span> },
    { key: 'delayed', header: 'Delayed', render: (r) => r.delayed },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Queues</h1>
        <p className="text-gray-500 text-sm mt-1">Live BullMQ job counts across every worker queue</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={health?.queueHealth ?? []} getRowKey={(r) => r.name} loading={loading} emptyMessage="No queues found" />
      </div>
    </div>
  );
}
