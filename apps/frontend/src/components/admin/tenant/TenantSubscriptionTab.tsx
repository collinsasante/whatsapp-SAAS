'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { adminApi, type WorkspaceDetail } from '@/lib/admin-api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/admin/format';
import { useAdmin } from '../AdminProvider';
import { Section } from '../PageHeader';
import { Facts } from '../DetailParts';
import { AdminTable, type Column } from '../AdminTable';
import { StatusPill, SubscriptionStatus, type PillTone } from '../StatusPill';
import { EmptyState, Unavailable } from '../States';
import { ActionDialog } from '../ActionDialog';

const PAYMENT_TONE: Record<string, PillTone> = { SUCCEEDED: 'success', FAILED: 'danger', PENDING: 'pending', REFUNDED: 'neutral' };
const INVOICE_TONE: Record<string, PillTone> = { PAID: 'success', OPEN: 'warning', VOID: 'neutral', UNCOLLECTIBLE: 'danger', DRAFT: 'neutral' };

const unlimited = (n: number) => (n === -1 ? 'Unlimited' : n.toLocaleString());

type Payment = WorkspaceDetail['payments'][number];
type Invoice = WorkspaceDetail['invoices'][number];

export function TenantSubscriptionTab({ data, onChanged }: { data: WorkspaceDetail; onChanged: () => void }) {
  const { isSuperAdmin } = useAdmin();
  const sub = data.subscription;
  const [enabled, setEnabled] = useState(data.settings?.commerceEnabled ?? false);
  const [rate, setRate] = useState(String(data.settings?.takeRatePct ?? 5));
  const [confirmCommerce, setConfirmCommerce] = useState(false);
  const pct = Number(rate);
  const rateOk = rate.trim() !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  const dirty = enabled !== (data.settings?.commerceEnabled ?? false) || (rateOk && pct !== (data.settings?.takeRatePct ?? 5));

  const paymentColumns: Column<Payment>[] = [
    { key: 'createdAt', header: 'Date', mobile: 'title', cell: (p) => formatDateTime(p.createdAt) },
    { key: 'status', header: 'Status', mobile: 'badge', cell: (p) => <StatusPill tone={PAYMENT_TONE[p.status] ?? 'neutral'}>{p.status.toLowerCase()}</StatusPill> },
    { key: 'gateway', header: 'Provider', mobile: 'line', cell: (p) => p.gateway },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'line', cell: (p) => formatMoney(p.amount, p.currency) },
    { key: 'reason', header: 'Failure reason', cell: (p) => p.failReason ?? <span className="text-gray-400">None</span> },
  ];
  const invoiceColumns: Column<Invoice>[] = [
    { key: 'invoiceNumber', header: 'Invoice', mobile: 'title', cell: (i) => i.invoiceNumber },
    { key: 'status', header: 'Status', mobile: 'badge', cell: (i) => <StatusPill tone={INVOICE_TONE[i.status] ?? 'neutral'}>{i.status.toLowerCase()}</StatusPill> },
    { key: 'total', header: 'Total', align: 'right', mobile: 'line', cell: (i) => formatMoney(i.total, i.currency) },
    { key: 'createdAt', header: 'Issued', mobile: 'line', cell: (i) => formatDate(i.createdAt) },
    { key: 'paidAt', header: 'Paid', cell: (i) => (i.paidAt ? formatDate(i.paidAt) : <span className="text-gray-400">Not paid</span>) },
  ];

  return (
    <div>
      <div className="grid lg:grid-cols-2 gap-x-10">
        <Section title="Subscription">
          {!sub ? <Unavailable>This tenant has no subscription record.</Unavailable> : (
            <Facts items={[
              { label: 'Plan', value: `${sub.plan.name} (${formatMoney(sub.cycle === 'YEARLY' ? sub.plan.yearlyPrice : sub.plan.monthlyPrice, sub.plan.currency)} ${sub.cycle === 'YEARLY' ? 'a year' : 'a month'})` },
              { label: 'Status', value: <SubscriptionStatus status={sub.status} /> },
              { label: 'Billing cycle', value: sub.cycle === 'YEARLY' ? 'Yearly' : 'Monthly' },
              { label: sub.cancelAtPeriodEnd ? 'Ends on' : 'Current period ends', value: formatDate(sub.currentPeriodEnd) },
              { label: 'Trial ends', value: sub.trialEndsAt ? formatDate(sub.trialEndsAt) : <span className="text-gray-400">Not on a trial</span> },
              { label: 'Cancellation', value: sub.cancelAtPeriodEnd ? 'Set to cancel at the end of the period' : sub.canceledAt ? `Canceled ${formatDate(sub.canceledAt)}` : 'Not canceling' },
            ]} />
          )}
          <p className="text-xs text-gray-500 mt-3">Subscription state and payment state are separate. A subscription can be active while the last payment failed; check the payments below.</p>
        </Section>

        <Section title="What the plan allows" description="The limits the platform enforces for this tenant.">
          {!sub ? <Unavailable>No plan, so no limits are recorded.</Unavailable> : (
            <Facts items={[
              { label: 'Agents', value: unlimited(sub.plan.limMaxAgents) }, { label: 'Channels', value: unlimited(sub.plan.limMaxChannels) },
              { label: 'Contacts', value: unlimited(sub.plan.limMaxContacts) }, { label: 'Messages a month', value: unlimited(sub.plan.limMessagesPerMonth) },
              { label: 'AI credits a month', value: unlimited(sub.plan.limAiCreditsPerMonth) }, { label: 'Campaigns', value: unlimited(sub.plan.limMaxCampaigns) },
              { label: 'Templates', value: unlimited(sub.plan.limMaxTemplates) }, { label: 'Storage', value: `${sub.plan.limStorageGb} GB` },
            ]} />
          )}
        </Section>
      </div>

      <Section title="Managed commerce" description="VerzChat's share of each paid order. Turning it on without a rate would charge nothing, so both are saved together.">
        <div className="rounded-lg border border-gray-200 bg-white p-4 max-w-xl">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={enabled} disabled={!isSuperAdmin} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 accent-teal-600" />
              Commerce enabled
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              Platform fee (%)
              <input type="number" min={0} max={100} step={0.1} value={rate} disabled={!isSuperAdmin} onChange={(e) => setRate(e.target.value)} aria-invalid={!rateOk} className="w-20 px-2 py-1 border border-gray-300 rounded-md text-right text-sm disabled:bg-gray-50" />
            </label>
            <button type="button" disabled={!isSuperAdmin || !dirty || !rateOk} onClick={() => setConfirmCommerce(true)} title={isSuperAdmin ? undefined : 'Only a super admin can change commerce settings'} className="px-3 py-1.5 text-sm font-medium rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
          </div>
          {!rateOk && <p role="alert" className="text-xs text-red-700 mt-2">Enter a number from 0 to 100.</p>}
          {!isSuperAdmin && <p className="text-xs text-gray-500 mt-2">Only a super admin can change this.</p>}
        </div>
        <ActionDialog
          open={confirmCommerce} onClose={() => setConfirmCommerce(false)} title="Change commerce settings" confirmLabel="Save settings"
          description={<>Commerce will be <strong>{enabled ? `on, with VerzChat taking ${pct}% of each paid order` : 'off'}</strong> for {data.name}.</>}
          onConfirm={async () => { await adminApi.setCommerceConfig(data.id, enabled, rateOk ? pct : 0); toast.success('Commerce settings saved'); onChanged(); }}
        />
      </Section>

      <Section title="Payments" description="The 20 most recent payments across all providers.">
        <AdminTable caption="Payments" columns={paymentColumns} rows={data.payments} rowKey={(p) => p.id} empty={<EmptyState title="No payments recorded" />} />
      </Section>
      <Section title="Invoices" description="The 10 most recent invoices.">
        <AdminTable caption="Invoices" columns={invoiceColumns} rows={data.invoices} rowKey={(i) => i.id} empty={<EmptyState title="No invoices" />} />
      </Section>
    </div>
  );
}
