'use client';
import Link from 'next/link';
import { AlertCircle, Globe, LayoutGrid, Mail, MapPin, Phone } from 'lucide-react';
import { formatNumber } from '@/lib/analytics/format';
import { buttonClasses } from '@/components/ui/Button';
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

/** A contact line: a link when there is a value, otherwise the label with "Not added". */
function Row({ icon: Icon, label, value, href }: { icon: React.ElementType; label: string; value: string | null; href?: string }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <Icon size={15} className="mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
      {value ? (
        <>
          <span className="sr-only">{label}: </span>
          {href
            ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="min-w-0 break-words text-teal-700 hover:underline">{value}</a>
            : <span className="min-w-0 break-words text-gray-800">{value}</span>}
        </>
      ) : (
        <span className="min-w-0"><span className="block text-xs text-gray-500">{label}</span><span className="block text-gray-500">Not added</span></span>
      )}
    </li>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dt className="text-[11px] leading-tight text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-gray-900 tabular-nums">{children}</dd>
    </div>
  );
}

export default function BusinessCard({ data }: { data: DashboardBusiness }) {
  const { business: b, account: a, missing } = data;
  const status = a.subscriptionStatus ? STATUS[a.subscriptionStatus] ?? { label: a.subscriptionStatus, tone: 'neutral' as StatusTone } : null;
  const renews = a.subscriptionStatus === 'TRIAL' ? day(a.trialEndsAt) : day(a.currentPeriodEnd);
  const renewLabel = a.subscriptionStatus === 'TRIAL' ? 'Trial ends' : a.cancelAtPeriodEnd ? 'Ends on' : 'Renews on';
  const plan = a.plan.charAt(0).toUpperCase() + a.plan.slice(1);
  return (
    <div>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><LayoutGrid size={20} /></span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{b.name || 'Your business'}</p>
          <p className="text-xs text-gray-500">{b.category || 'Workspace'}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        <Row icon={Phone} label="Phone" value={b.phone} href={b.phone ? `tel:${b.phone.replace(/\s+/g, '')}` : undefined} />
        <Row icon={Mail} label="Email" value={b.email} href={b.email ? `mailto:${b.email}` : undefined} />
        <Row icon={Globe} label="Website" value={b.website} href={b.website ? (/^https?:\/\//i.test(b.website) ? b.website : `https://${b.website}`) : undefined} />
        <Row icon={MapPin} label="Address" value={b.address} />
      </ul>

      {missing.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{missing.length} {missing.length === 1 ? 'detail is' : 'details are'} missing. <Link href="/settings" className="font-semibold underline">Add business details</Link></span>
        </p>
      )}

      <div className="mt-5 border-t border-gray-100 pt-4">
        <p className="text-xs text-gray-500">Plan</p>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-teal-50 px-3 py-1 text-lg font-semibold text-teal-700">{plan}</span>
          {status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
        </p>
        <p className="mt-3 text-xs text-gray-500">{renewLabel}</p>
        <p className="text-sm font-semibold text-gray-900">{renews ?? 'Not set'}</p>
      </div>

      <dl className="mt-4 grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100 pt-4">
        <Cell label="Team members">{formatNumber(a.members)}</Cell>
        <Cell label="Connected channels">{formatNumber(a.channels)}</Cell>
        <Cell label="AI credits left">{formatNumber(a.aiCreditsBalance)}</Cell>
      </dl>
      <dl className="mt-4 grid grid-cols-2 divide-x divide-gray-100 border-t border-gray-100 pt-4">
        <Cell label="Workspace created">{day(a.createdAt) ?? 'Unknown'}</Cell>
        <Cell label="Time zone">{a.timezone}</Cell>
      </dl>
      {a.billingEmail && <p className="mt-3 break-all text-xs text-gray-500">Billing email: {a.billingEmail}</p>}

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <Link href="/settings" className={buttonClasses('secondary', 'md', 'whitespace-nowrap px-2 text-[13px] border-teal-600 text-teal-700 hover:bg-teal-50')}>Edit business details</Link>
        <Link href="/billing" className={buttonClasses('primary', 'md', 'whitespace-nowrap px-2 text-[13px]')}>Manage plan</Link>
      </div>
    </div>
  );
}
