'use client';
import Link from 'next/link';
import { adminApi, type AiSpendCapRow } from '@/lib/admin-api';
import { useAdminData } from '@/lib/admin/hooks';
import { formatDateTime, formatNumber } from '@/lib/admin/format';
import { PageHeader } from '@/components/admin/PageHeader';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { StatusPill, type PillTone } from '@/components/admin/StatusPill';
import { EmptyState } from '@/components/admin/States';

const STATE: Record<string, { label: string; tone: PillTone }> = {
  OK: { label: 'Within cap', tone: 'success' }, WARNING: { label: 'Near the cap', tone: 'warning' }, REACHED: { label: 'Cap reached, AI paused', tone: 'danger' }, NO_CAP: { label: 'No cap', tone: 'neutral' },
};

export default function SpendCapsPage() {
  const caps = useAdminData(() => adminApi.aiSpendCaps(), []);
  const columns: Column<AiSpendCapRow>[] = [
    { key: 'tenant', header: 'Workspace', mobile: 'title', cell: (r) => <Link href={`/platform-admin/workspaces/${r.tenantId}?tab=ai`} className="text-teal-700 hover:underline">{r.name}</Link> },
    { key: 'state', header: 'Status', mobile: 'badge', cell: (r) => <StatusPill tone={STATE[r.state]?.tone ?? 'neutral'}>{STATE[r.state]?.label ?? r.state}</StatusPill> },
    { key: 'used', header: 'Used today', align: 'right', mobile: 'line', cell: (r) => `${formatNumber(r.spentToday + r.heldNow)} of ${formatNumber(r.cap)}` },
    { key: 'pct', header: 'Of cap', align: 'right', mobile: 'line', cell: (r) => (r.cap === 0 ? '100%' : `${Math.min(100, Math.round(((r.spentToday + r.heldNow) / r.cap) * 100))}%`) },
    { key: 'warn', header: 'Warns at', align: 'right', mobile: 'line', cell: (r) => `${r.warnPercent}%` },
    { key: 'reset', header: 'Resets', mobile: 'line', cell: (r) => <span title={r.timezone}>{formatDateTime(r.resetsAt)} ({r.timezone})</span> },
  ];
  return (
    <div>
      <PageHeader title="Daily spend caps" description="Workspaces with a daily Verz AI credit cap, and where each stands today. A cap pauses AI replies for the rest of the workspace's own day; people can still answer. Set a cap from the workspace's AI tab." />
      <AdminTable caption="Workspaces with a daily AI spend cap" columns={columns} rows={caps.data?.items ?? []} rowKey={(r) => r.tenantId} loading={caps.loading} error={caps.error} onRetry={caps.reload}
        empty={<EmptyState title="No workspace has a daily cap" />} />
    </div>
  );
}
