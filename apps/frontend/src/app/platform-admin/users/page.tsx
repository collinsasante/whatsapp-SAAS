'use client';
import Link from 'next/link';
import { adminApi, type AdminUser } from '@/lib/admin-api';
import { useAdminData, useUrlState } from '@/lib/admin/hooks';
import { formatDate, formatRelative } from '@/lib/admin/format';
import { PageHeader } from '@/components/admin/PageHeader';
import { FilterBar } from '@/components/admin/FilterBar';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { Pagination } from '@/components/admin/Pagination';
import { AccountStatus, StatusPill } from '@/components/admin/StatusPill';
import { EmptyState } from '@/components/admin/States';

const LIMIT = 30;
const ROLE_OPTIONS = [{ value: 'ADMIN', label: 'Admin' }, { value: 'AGENT', label: 'Agent' }, { value: 'VIEWER', label: 'Viewer' }];
const STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }];

export default function UsersPage() {
  const url = useUrlState({ sort: 'createdAt', order: 'desc' });
  const search = url.get('q');
  const role = url.get('role');
  const status = url.get('status');
  const tenantId = url.get('tenantId');
  const sort = url.get('sort') as 'createdAt' | 'lastLoginAt' | 'name';
  const order = url.get('order') as 'asc' | 'desc';
  const page = Math.max(1, Number(url.get('page')) || 1);

  const users = useAdminData(
    () => adminApi.users({ page, limit: LIMIT, search, role: role || undefined, status: status || undefined, tenantId: tenantId || undefined, sort, order }),
    [page, search, role, status, tenantId, sort, order],
  );

  const onSort = (key: string) => {
    if (key === sort) url.set({ order: order === 'asc' ? 'desc' : 'asc' });
    else url.set({ sort: key, order: key === 'name' ? 'asc' : 'desc' });
  };
  const clear = () => url.set({ q: '', role: '', status: '', tenantId: '' });

  const columns: Column<AdminUser>[] = [
    { key: 'name', header: 'User', sortable: true, mobile: 'title', cell: (u) => <span>{u.name || u.email}<span className="block text-xs font-normal text-gray-500">{u.email}</span></span> },
    { key: 'status', header: 'Status', mobile: 'badge', cell: (u) => <AccountStatus active={u.isActive} /> },
    { key: 'tenant', header: 'Workspace', mobile: 'line', cell: (u) => <Link href={`/platform-admin/workspaces/${u.tenant.id}`} className="text-teal-700 hover:underline">{u.tenant.name}</Link> },
    { key: 'role', header: 'Role', mobile: 'line', cell: (u) => <span className="text-xs font-medium text-gray-700">{u.role}</span> },
    { key: 'verified', header: 'Email', cell: (u) => (u.emailVerified ? <span className="text-xs text-gray-600">Verified</span> : <StatusPill tone="warning">Not verified</StatusPill>) },
    { key: 'lastLoginAt', header: 'Last sign-in', sortable: true, mobile: 'line', cell: (u) => formatRelative(u.lastLoginAt) },
    { key: 'createdAt', header: 'Joined', sortable: true, mobile: 'line', cell: (u) => formatDate(u.createdAt) },
  ];

  const data = users.data;
  const active = !!(search || role || status || tenantId);

  return (
    <div>
      <PageHeader
        title="Users"
        description={data ? `${data.total.toLocaleString()} ${data.total === 1 ? 'account' : 'accounts'}${active ? ' match these filters' : ' across every workspace'}.` : 'Every account across every workspace.'}
      />
      {tenantId && (
        <p className="mb-3 text-sm text-gray-700 bg-gray-100 rounded-md px-3 py-2">
          Showing one workspace&apos;s users. <Link href={`/platform-admin/workspaces/${tenantId}`} className="text-teal-700 hover:underline">Open the workspace</Link> or <button onClick={() => url.set({ tenantId: '' })} className="text-teal-700 hover:underline">show everyone</button>.
        </p>
      )}
      <FilterBar
        search={search} onSearch={(v) => url.set({ q: v })} placeholder="Search name, email, user ID or workspace" onClear={clear}
        filters={[
          { key: 'role', label: 'Any role', value: role, options: ROLE_OPTIONS, onChange: (v) => url.set({ role: v }) },
          { key: 'status', label: 'Any status', value: status, options: STATUS_OPTIONS, onChange: (v) => url.set({ status: v }) },
        ]}
      />
      <AdminTable
        caption="Users" columns={columns} rows={data?.users ?? []} rowKey={(u) => u.id} rowHref={(u) => `/platform-admin/users/${u.id}`}
        loading={users.loading} error={users.error} onRetry={users.reload} sortKey={sort} sortOrder={order} onSort={onSort}
        empty={<EmptyState title={active ? 'No users match these filters' : 'No users yet'} action={active ? <button onClick={clear} className="text-sm text-teal-700 hover:underline">Clear the filters</button> : undefined}>{active ? 'Try a shorter search, or remove a filter.' : undefined}</EmptyState>}
      />
      {data && data.total > LIMIT && (
        <div className="mt-3"><Pagination total={data.total} limit={LIMIT} offset={(page - 1) * LIMIT} onOffsetChange={(o) => url.set({ page: String(o / LIMIT + 1) }, { keepPage: true })} /></div>
      )}
    </div>
  );
}
