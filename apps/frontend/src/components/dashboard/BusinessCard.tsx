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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{value}</dd>
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
      <p className="text-base font-semibold text-gray-900">{b.name || 'Your business'}</p>
      {b.category && <p className="text-sm text-gray-500">{b.category}</p>}
      {b.description && <p className="text-sm text-gray-600 mt-1 line-clamp-3">{b.description}</p>}
      <ul className="mt-3 space-y-1.5">
        <Row icon={Phone} label="Phone" value={b.phone} href={b.phone ? `tel:${b.phone.replace(/\s+/g, '')}` : undefined} />
        <Row icon={Mail} label="Email" value={b.email} href={b.email ? `mailto:${b.email}` : undefined} />
        <Row icon={Globe} label="Website" value={b.website} href={b.website ? (/^https?:\/\//i.test(b.website) ? b.website : `https://${b.website}`) : undefined} />
        <Row icon={MapPin} label="Address" value={b.address} />
      </ul>
      {missing.length > 0 && (
        <p className="text-sm text-gray-600 mt-2">
          {missing.length} {missing.length === 1 ? 'detail is' : 'details are'} missing.{' '}
          <Link href="/settings" className="font-medium text-teal-700 hover:underline">Add business details</Link>
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4 pt-4 border-t border-gray-100">
        <Fact label="Plan" value={<span className="inline-flex flex-wrap items-center gap-1.5">{a.plan}{status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}</span>} />
        <Fact label={renewLabel} value={renews ?? 'Not set'} />
        <Fact label="Team members" value={formatNumber(a.members)} />
        <Fact label="Connected channels" value={formatNumber(a.channels)} />
        <Fact label="AI credits left" value={formatNumber(a.aiCreditsBalance)} />
        <Fact label="Workspace created" value={day(a.createdAt) ?? 'Unknown'} />
        <Fact label="Time zone" value={a.timezone} />
        {a.billingEmail && <Fact label="Billing email" value={<span className="break-all">{a.billingEmail}</span>} />}
      </dl>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-sm">
        <Link href="/settings" className="font-medium text-teal-700 hover:underline">Edit business details</Link>
        <Link href="/billing" className="font-medium text-teal-700 hover:underline">Manage plan</Link>
      </div>
    </div>
  );
}
