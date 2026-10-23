'use client';
import Link from 'next/link';
import type { AuditLogRow } from '@/lib/admin-api';
import { auditFailureReason, auditLabel, auditReason, auditTargetHref } from '@/lib/admin/audit';
import { formatRelative } from '@/lib/admin/format';
import { EmptyState } from './States';

/** Recent admin actions as sentences: who, what, to what, when, and the reason they gave. */
export function AuditList({ rows, compact }: { rows: Array<Pick<AuditLogRow, 'id' | 'action' | 'resourceType' | 'resourceId' | 'metadata' | 'createdAt'> & { admin: { name: string; email: string } | null }>; compact?: boolean }) {
  if (rows.length === 0) return <EmptyState title="No admin activity recorded yet">Actions taken in this console are recorded here with who did them and why.</EmptyState>;
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((r) => {
        const href = auditTargetHref(r);
        const reason = auditReason(r.metadata) ?? auditFailureReason(r.metadata);
        return (
          <li key={r.id} className={compact ? 'py-2' : 'py-2.5'}>
            <p className="text-sm text-gray-900">
              <span className="font-medium">{r.admin?.name ?? 'Someone not signed in'}</span>{' '}
              <span className="text-gray-700">{auditLabel(r.action).toLowerCase()}</span>
              {href && <> · <Link href={href} className="text-teal-700 hover:underline">open</Link></>}
            </p>
            <p className="text-xs text-gray-500">
              <time dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()}>{formatRelative(r.createdAt)}</time>
              {reason && <> · {reason}</>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
