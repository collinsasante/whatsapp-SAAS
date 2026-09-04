'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi, type WebhookEventRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';
import { StatusBadge, type BadgeTone } from '@/components/admin/Badge';
import { showConfirm } from '@/store/confirm.store';

const LIMIT = 30;
const STATUS_TONES: Record<string, BadgeTone> = { RECEIVED: 'info', PROCESSED: 'success', FAILED: 'danger' };
const SOURCES = ['WHATSAPP', 'STRIPE_BILLING', 'PAYSTACK_BILLING', 'PAYSTACK_COMMERCE'];

export default function WebhooksPage() {
  const [rows, setRows] = useState<WebhookEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reprocessing, setReprocessing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.webhookEvents({ source: source || undefined, status: status || undefined, limit: LIMIT, offset });
      setRows(res.items);
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [source, status, offset]);

  useEffect(() => { void load(); }, [load]);

  const reprocess = async (row: WebhookEventRow) => {
    if (!await showConfirm('Reprocess this webhook event?', { subtext: 'Only offered for sources with a proven idempotent handler.', danger: false })) return;
    setReprocessing(row.id);
    try {
      const result = await adminApi.reprocessWebhookEvent(row.id);
      toast[result.status === 'PROCESSED' ? 'success' : 'error'](`Reprocess ${result.status.toLowerCase()}`);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReprocessing(null);
    }
  };

  const columns: DataTableColumn<WebhookEventRow>[] = [
    { key: 'createdAt', header: 'Received', render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: 'source', header: 'Source', render: (r) => r.source },
    { key: 'eventType', header: 'Event', render: (r) => r.eventType },
    { key: 'tenant', header: 'Tenant', render: (r) => r.tenant ? <Link href={`/platform-admin/workspaces/${r.tenant.id}`} className="text-teal-600 hover:underline">{r.tenant.name}</Link> : <span className="text-gray-400">—</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} map={STATUS_TONES} /> },
    { key: 'attempts', header: 'Attempts', render: (r) => r.attempts },
    {
      key: 'actions', header: '', render: (r) => r.source === 'PAYSTACK_COMMERCE' && r.status === 'FAILED' && (
        <button onClick={() => reprocess(r)} disabled={reprocessing === r.id} className="text-teal-600 hover:underline text-xs font-medium disabled:opacity-50">
          {reprocessing === r.id ? 'Reprocessing…' : 'Reprocess'}
        </button>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-gray-500 text-sm mt-1">Every inbound webhook delivery — WhatsApp, Stripe, Paystack</p>
        </div>
        <div className="flex gap-2">
          <select value={source} onChange={(e) => { setSource(e.target.value); setOffset(0); }} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <option value="">All statuses</option>
            <option value="RECEIVED">Received</option>
            <option value="PROCESSED">Processed</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No webhook events found" />
        <div className="p-4 border-t border-gray-100">
          <Pagination total={total} limit={LIMIT} offset={offset} onOffsetChange={setOffset} />
        </div>
      </div>
    </div>
  );
}
