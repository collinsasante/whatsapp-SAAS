'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Package, Clock, Receipt } from 'lucide-react';
import { adminApi, type OrderDetail } from '@/lib/admin-api';
import { Panel } from '@/components/admin/Panel';
import { StatusBadge, type BadgeTone } from '@/components/admin/Badge';

const STATUS_TONES: Record<string, BadgeTone> = {
  DRAFT: 'neutral', AWAITING_APPROVAL: 'warning', PENDING_PAYMENT: 'warning',
  PAID: 'success', FULFILLING: 'info', COMPLETED: 'success', CANCELLED: 'neutral', REFUNDED: 'danger',
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrder(await adminApi.getOrder(id));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (error) return <div className="p-8 text-sm text-red-500 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>;
  if (!order) return null;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{order.id}</h1>
          <p className="text-gray-500 text-sm mt-1">
            <Link href={`/platform-admin/workspaces/${order.tenantId}`} className="text-teal-600 hover:underline">{order.tenant.name}</Link>
            {' · '}{order.customerName ?? order.customerPhone}
          </p>
        </div>
        <StatusBadge status={order.status} map={STATUS_TONES} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Summary" icon={Package}>
          <dl className="text-sm space-y-2">
            <div className="flex justify-between"><dt className="text-gray-500">Total</dt><dd className="font-medium">{order.currency} {order.totalMajorUnits.toFixed(2)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Created</dt><dd>{new Date(order.createdAt).toLocaleString()}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Paid</dt><dd>{order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Customer phone</dt><dd>{order.customerPhone}</dd></div>
          </dl>
        </Panel>

        <Panel title="Ledger entries" icon={Receipt}>
          {order.ledgerEntries.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-4">No ledger entries yet</div>
          ) : (
            <div className="space-y-2">
              {order.ledgerEntries.map((e) => (
                <div key={e.id} className="flex justify-between text-sm">
                  <span className="text-gray-700">{e.type}</span>
                  <span className={e.amountMajorUnits < 0 ? 'text-red-600' : 'text-emerald-600'}>
                    {e.amountMajorUnits > 0 ? '+' : ''}{e.amountMajorUnits.toFixed(2)} {order.currency}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Order events" icon={Clock} className="lg:col-span-2">
          {order.events.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-4">No events recorded</div>
          ) : (
            <div className="space-y-2">
              {order.events.map((e) => (
                <div key={e.id} className="flex justify-between text-sm border-b border-gray-50 pb-2 last:border-0">
                  <span className="text-gray-700 font-medium">{e.type}</span>
                  <span className="text-gray-400">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
