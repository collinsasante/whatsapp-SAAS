'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { adminApi, type UserDetail } from '@/lib/admin-api';
import { useAdminData } from '@/lib/admin/hooks';
import { formatDate, formatDateTime, formatRelative } from '@/lib/admin/format';
import { PageHeader, Section } from '@/components/admin/PageHeader';
import { useAdmin } from '@/components/admin/AdminProvider';
import { CopyId, Facts } from '@/components/admin/DetailParts';
import { ActionDialog } from '@/components/admin/ActionDialog';
import { AuditList } from '@/components/admin/AuditList';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { ErrorState, ReadOnlyNotice, Skeleton, Unavailable } from '@/components/admin/States';
import { AccountStatus, StatusPill, SubscriptionStatus } from '@/components/admin/StatusPill';
import { EmptyState } from '@/components/admin/States';

type Membership = UserDetail['memberships'][number];

export default function UserDetailPage() {
  const id = String(useParams()?.['id'] ?? '');
  const { canChange } = useAdmin();
  const user = useAdminData(() => adminApi.getUser(id), [id]);
  const [dialog, setDialog] = useState<null | 'suspend' | 'restore'>(null);
  const data = user.data;

  if (user.error && !data) return <div><PageHeader title="User" crumbs={[{ label: 'Users', href: '/platform-admin/users' }, { label: 'Not found' }]} /><div className="rounded-lg border border-gray-200 bg-white"><ErrorState message={user.error} onRetry={user.reload} /></div></div>;
  if (!data) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;

  const memberColumns: Column<Membership>[] = [
    { key: 'workspace', header: 'Workspace', mobile: 'title', cell: (m) => m.workspace.name },
    { key: 'role', header: 'Role', mobile: 'badge', cell: (m) => <span className="text-xs font-medium text-gray-700">{m.role}</span> },
    { key: 'status', header: 'Membership', mobile: 'line', cell: (m) => <StatusPill tone={m.status === 'ACTIVE' ? 'success' : m.status === 'SUSPENDED' ? 'danger' : 'pending'}>{m.status.toLowerCase()}</StatusPill> },
    { key: 'workspaceStatus', header: 'Workspace', mobile: 'line', cell: (m) => (m.workspace.isActive ? 'Active' : <StatusPill tone="danger">Suspended</StatusPill>) },
    { key: 'joined', header: 'Joined', mobile: 'line', cell: (m) => formatDate(m.joinedAt) },
  ];

  const title = data.name || data.email;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Users', href: '/platform-admin/users' }, { label: title }]}
        title={title}
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><AccountStatus active={data.isActive} /><span className="text-sm text-gray-600">{data.email}</span><CopyId value={data.id} label="User ID" /></span>}
        actions={data.isActive ? (
          <button onClick={() => setDialog('suspend')} disabled={!canChange} title={canChange ? undefined : 'Your role cannot suspend users'} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <PauseCircle className="w-4 h-4" aria-hidden="true" />Suspend user
          </button>
        ) : (
          <button onClick={() => setDialog('restore')} disabled={!canChange} title={canChange ? undefined : 'Your role cannot restore users'} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
            <PlayCircle className="w-4 h-4" aria-hidden="true" />Restore user
          </button>
        )}
      />
      {!canChange && <ReadOnlyNotice />}
      {data.isAiAgent && <div className="mb-4"><Unavailable>This is the Verz AI assistant account for the workspace, not a person.</Unavailable></div>}

      <div className="grid lg:grid-cols-2 gap-x-10">
        <Section title="Account">
          <Facts items={[
            { label: 'Role in their home workspace', value: data.role },
            { label: 'Email', value: data.emailVerified ? 'Verified' : <StatusPill tone="warning">Not verified</StatusPill> },
            { label: 'Joined', value: formatDate(data.createdAt) },
            { label: 'Last sign-in', value: data.lastLoginAt ? <span title={formatDateTime(data.lastLoginAt)}>{formatRelative(data.lastLoginAt)}</span> : 'Never' },
          ]} />
          <p className="text-xs text-gray-500 mt-3">Passwords and sign-in tokens are never shown in this console.</p>
        </Section>
        <Section title="Home workspace">
          <Facts items={[
            { label: 'Workspace', value: <Link href={`/platform-admin/workspaces/${data.tenant.id}`} className="text-teal-700 hover:underline">{data.tenant.name}</Link> },
            { label: 'Workspace status', value: <AccountStatus active={data.tenant.isActive} /> },
            { label: 'Plan', value: data.tenant.subscription ? data.tenant.subscription.plan.name : 'None' },
            { label: 'Subscription', value: data.tenant.subscription ? <SubscriptionStatus status={data.tenant.subscription.status} /> : 'No subscription' },
          ]} />
        </Section>
      </div>

      <Section title="Workspace memberships" description="Every workspace this person can sign in to, and their role in each.">
        <AdminTable caption="Memberships" columns={memberColumns} rows={data.memberships} rowKey={(m) => m.workspace.id} rowHref={(m) => `/platform-admin/workspaces/${m.workspace.id}`} empty={<EmptyState title="No other memberships" />} />
      </Section>

      <Section title="Admin activity on this account" description="Suspensions and restorations made through this console.">
        <div className="rounded-lg border border-gray-200 bg-white px-3"><AuditList rows={data.audit.map((a) => ({ ...a, resourceType: 'User', resourceId: data.id }))} /></div>
      </Section>

      <ActionDialog
        open={dialog === 'suspend'} onClose={() => setDialog(null)} tone="danger" title={`Suspend ${title}?`} confirmLabel="Suspend user"
        description="They are signed out and cannot sign in or refresh a session until restored. Their conversations and data stay as they are."
        reason={{ label: 'Why is this account being suspended?', required: true }}
        onConfirm={async (reason) => { await adminApi.toggleUserActive(data.id, reason); toast.success('User suspended'); user.reload(); }}
      />
      <ActionDialog
        open={dialog === 'restore'} onClose={() => setDialog(null)} title={`Restore ${title}?`} confirmLabel="Restore user"
        description="They can sign in again straight away."
        onConfirm={async () => { await adminApi.toggleUserActive(data.id); toast.success('User restored'); user.reload(); }}
      />
    </div>
  );
}
