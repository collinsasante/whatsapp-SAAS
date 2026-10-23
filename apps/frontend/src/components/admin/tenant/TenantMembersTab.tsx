'use client';
import type { WorkspaceDetail } from '@/lib/admin-api';
import { formatRelative } from '@/lib/admin/format';
import { AdminTable, type Column } from '../AdminTable';
import { EmptyState } from '../States';

type Member = WorkspaceDetail['users'][number];

export function TenantMembersTab({ data }: { data: WorkspaceDetail }) {
  const columns: Column<Member>[] = [
    { key: 'name', header: 'Name', mobile: 'title', cell: (u) => u.name || u.email },
    { key: 'email', header: 'Email', mobile: 'line', cell: (u) => u.email },
    { key: 'role', header: 'Role', mobile: 'badge', cell: (u) => <span className="text-xs font-medium text-gray-700">{u.role}</span> },
    { key: 'lastLoginAt', header: 'Last sign-in', mobile: 'line', cell: (u) => formatRelative(u.lastLoginAt) },
  ];
  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">Active accounts that belong to this workspace. Suspended accounts are not listed here; find them in <a className="text-teal-700 hover:underline" href={`/platform-admin/users?tenantId=${data.id}&status=suspended`}>Users</a>.</p>
      <AdminTable caption="Members" columns={columns} rows={data.users} rowKey={(u) => u.id} rowHref={(u) => `/platform-admin/users/${u.id}`} empty={<EmptyState title="No active members" />} />
    </div>
  );
}
