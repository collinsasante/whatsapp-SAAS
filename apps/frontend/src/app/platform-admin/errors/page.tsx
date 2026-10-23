'use client';
import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { adminApi, type ErrorLogRow } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatDateTime, formatRelative } from '@/lib/admin/format';
import { PageHeader } from '@/components/admin/PageHeader';
import { useAdmin } from '@/components/admin/AdminProvider';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { FilterBar } from '@/components/admin/FilterBar';
import { Pagination } from '@/components/admin/Pagination';
import { ActionDialog } from '@/components/admin/ActionDialog';
import { StatusPill, type PillTone } from '@/components/admin/StatusPill';
import { EmptyState } from '@/components/admin/States';

const LIMIT = 30;
const SEVERITY_TONE: Record<string, PillTone> = { WARN: 'warning', ERROR: 'danger', CRITICAL: 'danger' };
const STATUS_TONE: Record<string, PillTone> = { OPEN: 'warning', RESOLVED: 'success', IGNORED: 'neutral' };

export default function ErrorsPage() {
  const { canChange } = useAdmin();
  const url = useUrlState({ status: 'OPEN' });
  const rawStatus = url.get('status');
  // "Any status" has to be a value of its own: an empty one would fall back to the Open default.
  const status = rawStatus === 'ANY' ? '' : rawStatus;
  const severity = url.get('severity');
  const service = url.get('service');
  const tenantId = url.get('tenantId');
  const search = url.get('q');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const offset = (page - 1) * LIMIT;
  const [target, setTarget] = useState<{ row: ErrorLogRow; to: 'RESOLVED' | 'IGNORED' } | null>(null);

  // The service filter runs on the server so the total and the pages are right.
  const errors = useAdminData(() => adminApi.errors({ status: status || undefined, severity: severity || undefined, service: service || undefined, tenantId: tenantId || undefined, search: search || undefined, limit: LIMIT, offset }), [status, severity, service, tenantId, search, offset]);
  const data = errors.data;
  const clear = () => url.set({ status: '', severity: '', service: '', tenantId: '', q: '' });

  const columns: Column<ErrorLogRow>[] = [
    { key: 'message', header: 'Error', mobile: 'title', cell: (r) => <span className="block max-w-md truncate font-normal" title={r.message}>{r.message}</span> },
    { key: 'severity', header: 'Severity', mobile: 'badge', cell: (r) => <StatusPill tone={SEVERITY_TONE[r.severity] ?? 'neutral'}>{r.severity.toLowerCase()}</StatusPill> },
    { key: 'status', header: 'Status', mobile: 'badge', cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.toLowerCase()}</StatusPill> },
    { key: 'service', header: 'Service', mobile: 'line', cell: (r) => r.service },
    { key: 'tenant', header: 'Tenant', mobile: 'line', cell: (r) => (r.tenant ? <Link href={`/platform-admin/workspaces/${r.tenant.id}`} className="text-teal-700 hover:underline">{r.tenant.name}</Link> : <span className="text-gray-400">None</span>) },
    { key: 'count', header: 'Times', align: 'right', mobile: 'line', cell: (r) => r.occurrenceCount.toLocaleString() },
    { key: 'lastSeenAt', header: 'Last seen', mobile: 'line', cell: (r) => <time dateTime={r.lastSeenAt} title={`First seen ${formatDateTime(r.firstSeenAt)}`}>{formatRelative(r.lastSeenAt)}</time> },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) => (r.status === 'OPEN' ? (
        <span className="inline-flex gap-3 text-sm">
          <button onClick={() => setTarget({ row: r, to: 'RESOLVED' })} disabled={!canChange} title={canChange ? undefined : 'Your role cannot change error status'} className="text-teal-700 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed">Resolve</button>
          <button onClick={() => setTarget({ row: r, to: 'IGNORED' })} disabled={!canChange} title={canChange ? undefined : 'Your role cannot change error status'} className="text-gray-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed">Ignore</button>
        </span>
      ) : null),
    },
  ];

  return (
    <div>
      <PageHeader title="Errors" description="Errors logged by the platform, grouped so the same one is counted once. Resolving hides it until it happens again." />
      {tenantId && <p className="mb-3 text-sm text-gray-700 bg-gray-100 rounded-md px-3 py-2">Showing one tenant&apos;s errors. <button onClick={() => url.set({ tenantId: '' })} className="text-teal-700 hover:underline">Show all</button></p>}
      <FilterBar
        search={search} onSearch={(v) => url.set({ q: v })} placeholder="Search error text" onClear={clear}
        filters={[
          { key: 'status', label: 'Any status', value: status, options: [{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'IGNORED', label: 'Ignored' }], onChange: (v) => url.set({ status: v === '' ? 'ANY' : v }) },
          { key: 'severity', label: 'Any severity', value: severity, options: [{ value: 'CRITICAL', label: 'Critical' }, { value: 'ERROR', label: 'Error' }, { value: 'WARN', label: 'Warning' }], onChange: (v) => url.set({ severity: v }) },
          { key: 'service', label: 'Any service', value: service, options: [{ value: 'backend', label: 'Backend' }, { value: 'frontend', label: 'Frontend' }], onChange: (v) => url.set({ service: v }) },
        ]}
      />
      <AdminTable
        caption="Errors" columns={columns} rows={data?.items ?? []} rowKey={(r) => r.id} loading={errors.loading} error={errors.error} onRetry={errors.reload}
        empty={<EmptyState title={status === 'OPEN' && !severity && !service && !search && !tenantId ? 'No open errors' : 'No errors match these filters'}>{status === 'OPEN' ? 'Nothing is open. Change the status filter to see resolved or ignored errors.' : undefined}</EmptyState>}
      />
      {data && data.total > LIMIT && <div className="mt-3"><Pagination total={data.total} limit={LIMIT} offset={offset} onOffsetChange={(o) => url.set({ page: String(o / LIMIT + 1) }, { keepPage: true })} /></div>}

      <ActionDialog
        open={!!target} onClose={() => setTarget(null)} title={target?.to === 'RESOLVED' ? 'Mark as resolved?' : 'Ignore this error?'} confirmLabel={target?.to === 'RESOLVED' ? 'Resolve' : 'Ignore'}
        description={target ? <>{target.to === 'RESOLVED' ? 'It leaves the open list. If it happens again it comes back as open.' : 'It leaves the open list and will not be counted as needing attention.'}<span className="block mt-2 text-gray-800 line-clamp-3">{target.row.message}</span></> : null}
        onConfirm={async () => { if (!target) return; await adminApi.updateErrorStatus(target.row.id, target.to); toast.success('Updated'); errors.reload(); }}
      />
    </div>
  );
}
