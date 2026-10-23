'use client';
import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { adminApi, type WebhookEventRow } from '@/lib/admin-api';
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
const TONE: Record<string, PillTone> = { RECEIVED: 'info', PROCESSED: 'success', FAILED: 'danger' };
const SOURCE_LABEL: Record<string, string> = { WHATSAPP: 'WhatsApp', STRIPE_BILLING: 'Stripe billing', PAYSTACK_BILLING: 'Paystack billing', PAYSTACK_COMMERCE: 'Paystack commerce' };
const SOURCES = Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }));
const STATUSES = [{ value: 'FAILED', label: 'Failed' }, { value: 'RECEIVED', label: 'Received' }, { value: 'PROCESSED', label: 'Processed' }];

export default function WebhooksPage() {
  const { isSuperAdmin } = useAdmin();
  const url = useUrlState();
  const source = url.get('source');
  const status = url.get('status');
  const tenantId = url.get('tenantId');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const offset = (page - 1) * LIMIT;
  const [target, setTarget] = useState<WebhookEventRow | null>(null);

  const events = useAdminData(() => adminApi.webhookEvents({ source: source || undefined, status: status || undefined, tenantId: tenantId || undefined, limit: LIMIT, offset }), [source, status, tenantId, offset]);
  const data = events.data;
  const clear = () => url.set({ source: '', status: '', tenantId: '' });

  const columns: Column<WebhookEventRow>[] = [
    { key: 'createdAt', header: 'Received', mobile: 'title', cell: (r) => <time dateTime={r.createdAt} title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</time> },
    { key: 'status', header: 'Status', mobile: 'badge', cell: (r) => <StatusPill tone={TONE[r.status] ?? 'neutral'}>{r.status.toLowerCase()}</StatusPill> },
    { key: 'source', header: 'Source', mobile: 'line', cell: (r) => SOURCE_LABEL[r.source] ?? r.source },
    { key: 'eventType', header: 'Event', mobile: 'line', cell: (r) => <span className="font-mono text-xs">{r.eventType}</span> },
    { key: 'tenant', header: 'Tenant', mobile: 'line', cell: (r) => (r.tenant ? <Link href={`/platform-admin/workspaces/${r.tenant.id}`} className="text-teal-700 hover:underline">{r.tenant.name}</Link> : <span className="text-gray-400">None</span>) },
    { key: 'attempts', header: 'Attempts', align: 'right', cell: (r) => r.attempts },
    { key: 'error', header: 'Error', cell: (r) => (r.error ? <span className="text-xs text-rose-800 line-clamp-2 max-w-xs" title={r.error}>{r.error}</span> : <span className="text-gray-400">None</span>) },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) => (r.source === 'PAYSTACK_COMMERCE' && r.status === 'FAILED' ? (
        <button onClick={() => setTarget(r)} disabled={!isSuperAdmin} title={isSuperAdmin ? undefined : 'Only a super admin can reprocess events'} className="text-sm text-teal-700 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed">Reprocess</button>
      ) : null),
    },
  ];

  return (
    <div>
      <PageHeader title="Webhooks" description="Every event received from WhatsApp, Stripe and Paystack, and whether it was processed." />
      {tenantId && <p className="mb-3 text-sm text-gray-700 bg-gray-100 rounded-md px-3 py-2">Showing one tenant&apos;s events. <button onClick={() => url.set({ tenantId: '' })} className="text-teal-700 hover:underline">Show all</button></p>}
      <FilterBar
        onClear={clear}
        filters={[
          { key: 'source', label: 'Any source', value: source, options: SOURCES, onChange: (v) => url.set({ source: v }) },
          { key: 'status', label: 'Any status', value: status, options: STATUSES, onChange: (v) => url.set({ status: v }) },
        ]}
      />
      <AdminTable
        caption="Webhook events" columns={columns} rows={data?.items ?? []} rowKey={(r) => r.id} loading={events.loading} error={events.error} onRetry={events.reload}
        empty={<EmptyState title={source || status || tenantId ? 'No events match these filters' : 'No webhook events recorded'} />}
      />
      {data && data.total > LIMIT && <div className="mt-3"><Pagination total={data.total} limit={LIMIT} offset={offset} onOffsetChange={(o) => url.set({ page: String(o / LIMIT + 1) }, { keepPage: true })} /></div>}
      <p className="text-xs text-gray-500 mt-3">Only failed Paystack commerce events can be reprocessed. The other sources have no replay that is safe to run twice.</p>

      <ActionDialog
        open={!!target} onClose={() => setTarget(null)} title="Reprocess this event?" confirmLabel="Reprocess"
        description={<>The platform will run the original handler for this event again. It is safe to run twice: the handler ignores events it has already applied.</>}
        details={target ? <>{SOURCE_LABEL[target.source]} · <span className="font-mono text-xs">{target.eventType}</span> · {target.attempts} {target.attempts === 1 ? 'attempt' : 'attempts'} so far</> : undefined}
        onConfirm={async () => {
          if (!target) return;
          const result = await adminApi.reprocessWebhookEvent(target.id);
          if (result.status !== 'PROCESSED') throw new Error('The event was tried again and failed again. See the error on the row.');
          toast.success('Event processed'); events.reload();
        }}
      />
    </div>
  );
}
