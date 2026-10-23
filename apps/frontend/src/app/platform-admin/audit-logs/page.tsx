'use client';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { adminApi, type AuditLogRow } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatDateTime, formatRelative } from '@/lib/admin/format';
import { AUDIT_ACTION_OPTIONS, SENSITIVE_ACTIONS, auditLabel, auditNote, auditTargetHref } from '@/lib/admin/audit';
import { PageHeader } from '@/components/admin/PageHeader';
import { FilterBar } from '@/components/admin/FilterBar';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { Pagination } from '@/components/admin/Pagination';
import { EmptyState } from '@/components/admin/States';

const LIMIT = 40;

const GROUPS = [
  { value: 'auth', label: 'All sign-in events' }, { value: 'workspace', label: 'All tenant actions' }, { value: 'user', label: 'All user actions' },
];

/** Recorded details other than the reason, as "name: value" for a quick read. Never the whole payload. */
function detailSummary(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '';
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([k, v]) => k !== 'reason' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
    .slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`).join(' · ');
}

export default function AuditLogPage() {
  const url = useUrlState();
  const q = url.get('q');
  const action = url.get('action');
  const from = url.get('from');
  const to = url.get('to');
  const resourceId = url.get('resourceId');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const offset = (page - 1) * LIMIT;

  const logs = useAdminData(() => adminApi.auditLogs({ q: q || undefined, action: action || undefined, from: from || undefined, to: to || undefined, resourceId: resourceId || undefined, limit: LIMIT, offset }), [q, action, from, to, resourceId, offset]);
  const data = logs.data;
  const active = !!(q || action || from || to || resourceId);
  const clear = () => url.set({ q: '', action: '', from: '', to: '', resourceId: '' });

  const columns: Column<AuditLogRow>[] = [
    { key: 'when', header: 'When', mobile: 'title', cell: (r) => <time dateTime={r.createdAt} title={formatDateTime(r.createdAt)} className="whitespace-nowrap">{formatRelative(r.createdAt)}</time> },
    {
      key: 'action', header: 'What happened', mobile: 'badge',
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {SENSITIVE_ACTIONS.has(r.action) && <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-label="Sensitive action" />}
          <span className="font-medium text-gray-900">{auditLabel(r.action)}</span>
        </span>
      ),
    },
    { key: 'admin', header: 'Who', mobile: 'line', cell: (r) => (r.admin ? <span>{r.admin.name}<span className="block text-xs text-gray-500">{r.admin.email}</span></span> : <span className="text-gray-500">Not signed in</span>) },
    {
      key: 'target', header: 'Target', mobile: 'line',
      cell: (r) => {
        const href = auditTargetHref(r);
        if (!r.resourceType) return <span className="text-gray-400">None</span>;
        return href ? <Link href={href} className="text-teal-700 hover:underline">{r.resourceType}</Link> : <span>{r.resourceType}</span>;
      },
    },
    {
      key: 'why', header: 'Reason and details', mobile: 'line',
      cell: (r) => {
        const reason = auditNote(r.action, r.metadata);
        const extra = detailSummary(r.metadata);
        return <span className="text-sm">{reason ?? <span className="text-gray-400">No reason recorded</span>}{extra && <span className="block text-xs text-gray-500">{extra}</span>}</span>;
      },
    },
    { key: 'ip', header: 'From', cell: (r) => <span className="font-mono text-xs text-gray-600">{r.ipAddress ?? 'n/a'}</span> },
  ];

  return (
    <div>
      <PageHeader title="Audit log" description="Every privileged action taken in this console, and every sign-in attempt. Entries cannot be edited or deleted from here." />
      {resourceId && <p className="mb-3 text-sm text-gray-700 bg-gray-100 rounded-md px-3 py-2">Showing the history of one record. <button onClick={() => url.set({ resourceId: '' })} className="text-teal-700 hover:underline">Show everything</button></p>}
      <FilterBar
        search={q} onSearch={(v) => url.set({ q: v })} placeholder="Search by admin name or email" onClear={clear}
        filters={[{ key: 'action', label: 'Any action', value: action, onChange: (v) => url.set({ action: v }), options: [...GROUPS, ...AUDIT_ACTION_OPTIONS] }]}
        extra={
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <label htmlFor="audit-from" className="sr-only">From date</label>
            <input id="audit-from" type="date" value={from} max={to || undefined} onChange={(e) => url.set({ from: e.target.value })} className="py-1.5 px-2 border border-gray-300 rounded-md text-sm bg-white" />
            <span aria-hidden="true">to</span>
            <label htmlFor="audit-to" className="sr-only">To date</label>
            <input id="audit-to" type="date" value={to} min={from || undefined} onChange={(e) => url.set({ to: e.target.value })} className="py-1.5 px-2 border border-gray-300 rounded-md text-sm bg-white" />
          </div>
        }
      />
      <AdminTable
        caption="Audit log" columns={columns} rows={data?.items ?? []} rowKey={(r) => r.id} loading={logs.loading} error={logs.error} onRetry={logs.reload}
        empty={<EmptyState title={active ? 'Nothing matches these filters' : 'No activity recorded yet'} action={active ? <button onClick={clear} className="text-sm text-teal-700 hover:underline">Clear the filters</button> : undefined}>{active ? 'Widen the dates or remove a filter.' : 'Actions taken in this console will appear here.'}</EmptyState>}
      />
      {data && data.total > LIMIT && <div className="mt-3"><Pagination total={data.total} limit={LIMIT} offset={offset} onOffsetChange={(o) => url.set({ page: String(o / LIMIT + 1) }, { keepPage: true })} /></div>}
      <p className="text-xs text-gray-500 mt-3">The shield marks actions that change what a customer can do, pay or see, and failed sign-ins.</p>
    </div>
  );
}
