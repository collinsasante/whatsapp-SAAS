'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { adminApi, type AuditLogRow } from '@/lib/admin-api';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Pagination } from '@/components/admin/Pagination';

const LIMIT = 30;

export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.auditLogs({ action: action || undefined, limit: LIMIT, offset });
      setRows(res.items);
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [action, offset]);

  useEffect(() => { void load(); }, [load]);

  const columns: DataTableColumn<AuditLogRow>[] = [
    { key: 'createdAt', header: 'When', render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: 'admin', header: 'Admin', render: (r) => r.admin ? <span className="font-medium text-gray-900">{r.admin.name}</span> : <span className="text-gray-400">System</span> },
    { key: 'action', header: 'Action', render: (r) => <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.action}</span> },
    { key: 'resource', header: 'Resource', render: (r) => r.resourceType ? `${r.resourceType}${r.resourceId ? ` · ${r.resourceId.slice(0, 8)}` : ''}` : '—' },
    { key: 'ipAddress', header: 'IP', render: (r) => r.ipAddress ?? '—' },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
          <p className="text-gray-500 text-sm mt-1">Every mutating platform-admin action</p>
        </div>
        <input
          value={action}
          onChange={(e) => { setAction(e.target.value); setOffset(0); }}
          placeholder="Filter by action (e.g. admin.invite)…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-64"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} loading={loading} emptyMessage="No audit log entries found" />
        <div className="p-4 border-t border-gray-100">
          <Pagination total={total} limit={LIMIT} offset={offset} onOffsetChange={setOffset} />
        </div>
      </div>
    </div>
  );
}
