'use client';
import Link from 'next/link';
import type { WorkspaceDetail } from '@/lib/admin-api';
import { formatDate, formatNumber } from '@/lib/admin/format';
import { Section } from '../PageHeader';
import { Facts } from '../DetailParts';
import { TrendChart } from '../TrendChart';
import { Hint } from '../MetricStrip';
import { StatusPill, SubscriptionStatus } from '../StatusPill';
import { EmptyState } from '../States';

const HEALTH_PARTS = [
  ['Sign-in activity', 'loginActivity', 25], ['Messaging activity', 'messageActivity', 25], ['Broadcast activity', 'broadcastActivity', 15],
  ['Team size', 'teamSize', 15], ['Payment status', 'paymentStatus', 20],
] as const;

const LIFECYCLE: Record<string, string> = {
  signed_up: 'Signed up', whatsapp_connected: 'Connected a WhatsApp number', template_approved: 'Has an approved template',
  first_engagement: 'Has engaged customers', team_invited: 'Invited teammates', converted_paid: 'Has paid',
  active_last_7_days: 'Paying and active this week',
};

export function TenantOverviewTab({ data }: { data: WorkspaceDetail }) {
  const messageRows = data.usage.messageTrend.map((r) => ({ date: r.date, sent: r.sent, received: r.received }));
  const conversationRows = data.usage.conversationTrend.map((r) => ({ date: r.date, opened: r.opened, resolved: r.resolved }));
  const id = data.id;

  const issues = [
    { label: 'Open errors', n: data.issues.openErrors, href: `/platform-admin/errors?tenantId=${id}&status=OPEN` },
    { label: 'Failed webhooks (7 days)', n: data.issues.failedWebhooks7d, href: `/platform-admin/webhooks?tenantId=${id}&status=FAILED` },
    { label: 'Failed payments (30 days)', n: data.issues.failedPayments30d, href: `/platform-admin/billing?tenantId=${id}&status=FAILED` },
  ];
  const anyIssue = issues.some((i) => i.n > 0);

  return (
    <div className="grid lg:grid-cols-3 gap-x-8">
      <div className="lg:col-span-2">
        <Section title="Operational issues" description="Recorded problems for this tenant. A zero means none was recorded, not that nothing could go wrong.">
          <ul className="grid sm:grid-cols-3 gap-px bg-gray-200 border border-gray-200 rounded-lg overflow-hidden">
            {issues.map((i) => (
              <li key={i.label} className="bg-white p-3">
                <p className="text-xs text-gray-500">{i.label}</p>
                <p className="text-xl font-semibold tabular-nums text-gray-900">{i.n}</p>
                {i.n > 0 ? <Link href={i.href} className="text-xs text-teal-700 hover:underline">See them</Link> : <span className="text-xs text-gray-400">None recorded</span>}
              </li>
            ))}
          </ul>
          {!anyIssue && <p className="text-xs text-gray-500 mt-2">No errors, failed webhooks or failed payments are on record for this tenant.</p>}
        </Section>

        <Section title="Activity, last 90 days" description="Daily counts from the platform's rollups.">
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-5">
            <div>
              <p className="text-xs font-medium text-gray-700 mb-1">Messages</p>
              {messageRows.length === 0 ? <EmptyState title="No messages recorded" /> : (
                <TrendChart height={180} data={messageRows} series={[{ key: 'sent', name: 'Sent', color: '#0f766e' }, { key: 'received', name: 'Received', color: '#64748b' }]}
                  summary={`Messages sent and received per day over ${messageRows.length} days.`} />
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-gray-700 mb-1">Conversations</p>
              {conversationRows.length === 0 ? <EmptyState title="No conversations recorded" /> : (
                <TrendChart height={180} data={conversationRows} series={[{ key: 'opened', name: 'Opened', color: '#0f766e' }, { key: 'resolved', name: 'Resolved', color: '#64748b' }]}
                  summary={`Conversations opened and resolved per day over ${conversationRows.length} days.`} />
              )}
            </div>
          </div>
        </Section>
      </div>

      <div>
        <Section title="Profile">
          <Facts items={[
            { label: 'Plan', value: data.subscription ? <span className="inline-flex items-center gap-1.5">{data.subscription.plan.name} <SubscriptionStatus status={data.subscription.status} /></span> : 'No subscription' },
            { label: 'Signed up', value: formatDate(data.createdAt) },
            { label: 'Billing email', value: data.billingEmail ?? <span className="text-gray-400">Not set</span> },
            { label: 'Country', value: data.country ?? <span className="text-gray-400">Not set</span> },
            { label: 'Where they are in setup', value: LIFECYCLE[data.lifecycleStage] ?? data.lifecycleStage },
            { label: 'Members', value: formatNumber(data._count.users) },
            { label: 'Conversations', value: formatNumber(data._count.conversations) },
            { label: 'Contacts', value: formatNumber(data._count.contacts) },
          ]} />
        </Section>

        <Section title="Health" description="A 0 to 100 score. It describes how the tenant is using VerzChat.">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl font-semibold tabular-nums">{data.healthScore}</span>
            <span className="text-sm text-gray-500">out of 100</span>
            {data.churnRisk && <StatusPill tone="warning">At risk of churning</StatusPill>}
            <Hint label="Health score">Built from sign-in activity (25), messaging (25), broadcasts (15), team size (15) and payment status (20). At risk means a past-due subscription, a sharp fall in messages, or no activity for 14 days.</Hint>
          </div>
          <ul className="space-y-2">
            {HEALTH_PARTS.map(([label, key, max]) => {
              const value = data.healthBreakdown[key];
              return (
                <li key={key}>
                  <div className="flex justify-between text-xs text-gray-600 mb-0.5"><span>{label}</span><span className="tabular-nums">{value} of {max}</span></div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true"><div className="h-full rounded-full bg-teal-600" style={{ width: `${(value / max) * 100}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </div>
  );
}
