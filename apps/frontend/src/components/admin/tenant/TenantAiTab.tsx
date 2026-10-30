'use client';
import Link from 'next/link';
import type { WorkspaceDetail } from '@/lib/admin-api';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/admin/format';
import { Section } from '../PageHeader';
import { AdminTable, type Column } from '../AdminTable';
import { StatusPill, type PillTone } from '../StatusPill';
import { EmptyState } from '../States';

type Purchase = WorkspaceDetail['creditPurchases'][number];
const TONE: Record<string, PillTone> = { PAID: 'success', COMPLETED: 'success', PENDING: 'pending', FAILED: 'danger' };

export function TenantAiTab({ data }: { data: WorkspaceDetail }) {
  const columns: Column<Purchase>[] = [
    { key: 'createdAt', header: 'Date', mobile: 'title', cell: (p) => formatDateTime(p.createdAt) },
    { key: 'status', header: 'Status', mobile: 'badge', cell: (p) => <StatusPill tone={TONE[p.status] ?? 'neutral'}>{p.status.toLowerCase()}</StatusPill> },
    { key: 'pack', header: 'Package', mobile: 'line', cell: (p) => p.packSlug },
    { key: 'credits', header: 'Credits', align: 'right', mobile: 'line', cell: (p) => formatNumber(p.credits) },
    { key: 'amount', header: 'Paid', align: 'right', mobile: 'line', cell: (p) => formatMoney(p.amount, p.currency) },
  ];
  return (
    <div>
      <Section title="Credit balance">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <p className="text-3xl font-semibold tabular-nums text-gray-900">{formatNumber(data.aiCredits)}</p>
            <p className="text-sm text-gray-500">credits left</p>
          </div>
          <p className="text-sm text-gray-600 max-w-md">Verz AI replies stop for this tenant when the balance reaches zero. See every grant, purchase and use in <Link className="text-teal-700 hover:underline" href={`/platform-admin/ai/transactions?tenantId=${data.id}`}>credit transactions</Link>.</p>
        </div>
      </Section>
      <Section title="Credit purchases" description="The 10 most recent purchases.">
        <AdminTable caption="Credit purchases" columns={columns} rows={data.creditPurchases} rowKey={(p) => p.id} empty={<EmptyState title="No credit purchases" />} />
      </Section>
    </div>
  );
}
