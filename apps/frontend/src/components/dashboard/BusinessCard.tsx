'use client';
import Link from 'next/link';
import { Globe, Mail, MapPin, Phone } from 'lucide-react';
import { formatNumber } from '@/lib/analytics/format';
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge';
import type { DashboardBusiness } from '@/lib/dashboard/types';

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  TRIAL: { label: 'Free trial', tone: 'info' },
  PAST_DUE: { label: 'Payment overdue', tone: 'warning' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
  CANCELED: { label: 'Canceled', tone: 'warning' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
};

function day(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

function Row({ icon: Icon, label, value, href }: { icon: React.ElementType; label: string; value: string | null; href?: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Icon size={15} className="text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      {value
        ? (href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="text-teal-700 hover:underline break-words min-w-0">{value}</a>
                : <span className="text-gray-800 break-words min-w-0">{value}</span>)
        : <span className="text-gray-400">{label} not added</span>}
    </li>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium text-gray-900">{children}</dd>
    </div>
  );
}

export default function BusinessCard({ data }: { data: DashboardBusiness }) {
  const { business: b, account: a, missing } = data;
  const status = a.subscriptionStatus ? STATUS[a.subscriptionStatus] ?? { label: a.subscriptionStatus, tone: 'neutral' as StatusTone } : null;
  const renews = a.subscriptionStatus === 'TRIAL' ? day(a.trialEndsAt) : day(a.currentPeriodEnd);
  const renewLabel = a.subscriptionStatus === 'TRIAL' ? 'Trial ends' : a.cancelAtPeriodEnd ? 'Ends on' : 'Renews on';
  return (
    <div>
      <section aria-labelledby="biz-profile">
        <h3 id="biz-profile" className="text-sm font-semibold text-gray-900">Business profile</h3>
        <p className="mt-1 text-base font-semibold text-gray-900">{b.name || 'Your business'}</p>
        {b.category && <p className="text-sm text-gray-500">{b.category}</p>}
        <ul className="mt-2 space-y-1.5">
          <Row icon={Phone} label="Phone" value={b.phone} href={b.phone ? `tel:${b.phone.replace(/\s+/g, '')}` : undefined} />
          <Row icon={Mail} label="Email" value={b.email} href={b.email ? `mailto:${b.email}` : undefined} />
          <Row icon={Globe} label="Website" value={b.website} href={b.website ? (/^https?:\/\//i.test(b.website) ? b.website : `https://${b.website}`) : undefined} />
          <Row icon={MapPin} label="Address" value={b.address} />
        </ul>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {missing.length > 0 && <StatusBadge tone="warning">{missing.length} {missing.length === 1 ? 'detail' : 'details'} missing</StatusBadge>}
          <Link href="/settings" className="font-medium text-teal-700 hover:underline">Edit business details</Link>
        </p>
      </section>

      <section aria-labelledby="biz-plan" className="mt-4 border-t border-gray-100 pt-4">
        <h3 id="biz-plan" className="text-sm font-semibold text-gray-900">Subscription and usage</h3>
        <dl className="mt-1 divide-y divide-gray-100">
          <Line label="Plan"><span className="inline-flex flex-wrap items-center justify-end gap-1.5">{a.plan.charAt(0).toUpperCase() + a.plan.slice(1)}{status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}</span></Line>
          <Line label={renewLabel}>{renews ?? 'Not set'}</Line>
          <Line label="Team members">{formatNumber(a.members)}</Line>
          <Line label="Connected channels">{formatNumber(a.channels)}</Line>
          <Line label="AI credits left">{formatNumber(a.aiCreditsBalance)}</Line>
          <Line label="Workspace created">{day(a.createdAt) ?? 'Unknown'}</Line>
          <Line label="Time zone">{a.timezone}</Line>
          {a.billingEmail && <Line label="Billing email"><span className="break-all">{a.billingEmail}</span></Line>}
        </dl>
        <Link href="/billing" className="mt-3 inline-flex text-sm font-medium text-teal-700 hover:underline">Manage plan</Link>
      </section>
    </div>
  );
}
