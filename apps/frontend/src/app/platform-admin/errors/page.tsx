'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi, type ErrorLogRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';
import { StatusBadge, type BadgeTone } from '@/components/admin/Badge';
import { showConfirm } from '@/store/confirm.store';

const LIMIT = 30;
const SEVERITY_TONES: Record<string, BadgeTone> = { WARN: 'warning', ERROR: 'danger', CRITICAL: 'danger' };
const STATUS_TONES: Record<string, BadgeTone> = { OPEN: 'warning', RESOLVED: 'success', IGNORED: 'neutral' };

export default function ErrorsPage() {
  const [rows, setRows] = useState<ErrorLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('OPEN');
  const [service, setService] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.errors({ status: status || undefined, limit: LIMIT, offset });
      setRows(service ? res.items.filter((r) => r.service === service) : res.items);
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, service, offset]);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = async (row: ErrorLogRow, newStatus: 'RESOLVED' | 'IGNORED') => {
    if (!await showConfirm(`Mark this error as ${newStatus.toLowerCase()}?`, { danger: false })) return;
    try {
      await adminApi.updateErrorStatus(row.id, newStatus);
      toast.success('Updated');
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const columns: DataTableColumn<ErrorLogRow>[] = [
    { key: 'lastSeenAt', header: 'Last seen', render: (r) => new Date(r.lastSeenAt).toLocaleString() },
    { key: 'severity', header: 'Severity', render: (r) => <StatusBadge status={r.severity} map={SEVERITY_TONES} /> },
    { key: 'service', header: 'Service', render: (r) => r.service },
    { key: 'tenant', header: 'Tenant', render: (r) => r.tenant ? <Link href={`/platform-admin/workspaces/${r.tenant.id}`} className="text-teal-600 hover:underline">{r.tenant.name}</Link> : <span className="text-gray-400">—</span> },
    { key: 'message', header: 'Message', render: (r) => <span className="text-gray-700 truncate block max-w-md" title={r.message}>{r.message}</span> },
    { key: 'occurrenceCount', header: 'Count', render: (r) => r.occurrenceCount },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} map={STATUS_TONES} /> },
    {
      key: 'actions', header: '', render: (r) => r.status === 'OPEN' && (
        <div className="flex gap-2">
          <button onClick={() => updateStatus(r, 'RESOLVED')} className="text-emerald-600 hover:underline text-xs font-medium">Resolve</button>
          <button onClick={() => updateStatus(r, 'IGNORED')} className="text-gray-500 hover:underline text-xs font-medium">Ignore</button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Errors</h1>
          <p className="text-gray-500 text-sm mt-1">Deduped backend/frontend errors, dedup key = service+resource+message prefix</p>
        </div>
        <div className="flex gap-2">
          <select value={service} onChange={(e) => { setService(e.target.value); setOffset(0); }} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <option value="">All services</option>
            <option value="backend">Backend</option>
            <option value="frontend">Frontend</option>
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="IGNORED">Ignored</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No errors — nothing logged since this shipped" />
        <div className="p-4 border-t border-gray-100">
          <Pagination total={total} limit={LIMIT} offset={offset} onOffsetChange={setOffset} />
        </div>
      </div>
    </div>
  );
}
