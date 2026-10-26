'use client';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import StatusBadge, { type StatusTone } from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { numberStatusTone, qualityText, tierText, titleCase } from '@/lib/dashboard/whatsapp';
import type { DashboardWhatsAppStatus, WhatsAppNumberStatus } from '@/lib/dashboard/types';

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function verificationTone(value: string | null): StatusTone {
  switch ((value ?? '').toUpperCase()) {
    case 'VERIFIED': return 'success';
    case 'EXPIRED': return 'danger';
    case 'NOT_VERIFIED': return 'warning';
    default: return 'neutral';
  }
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 py-3', className)}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-gray-900">{children}</dd>
    </div>
  );
}

function NumberBlock({ n }: { n: WhatsAppNumberStatus }) {
  const live = n.live;
  const q = qualityText(live?.quality);
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
        {live?.verifiedName ?? n.label}
        {n.isDefault && <StatusBadge>Default</StatusBadge>}
        {live?.numberStatus && live.numberStatus.toUpperCase() !== 'CONNECTED' && <StatusBadge tone={numberStatusTone(live.numberStatus)}>{titleCase(live.numberStatus)}</StatusBadge>}
      </p>
      {live?.displayPhone && <p className="text-sm text-gray-600">{live.displayPhone}</p>}

      {live ? (
        <dl className="mt-2 grid grid-cols-2 divide-gray-100 border-t border-gray-100 [&>div:nth-child(odd)]:pr-3 [&>div:nth-child(even)]:border-l [&>div:nth-child(even)]:border-gray-100 [&>div:nth-child(even)]:pl-4 [&>div:nth-child(n+3)]:border-t [&>div:nth-child(n+3)]:border-gray-100">
          <Fact label="Number quality"><StatusBadge tone={q.tone}>{q.label}</StatusBadge></Fact>
          <Fact label="Messaging limit">{tierText(live.messagingLimit)}</Fact>
          <Fact label="Verification"><StatusBadge tone={verificationTone(live.verification)}>{titleCase(live.verification)}</StatusBadge></Fact>
          <Fact label="Display name">{titleCase(live.nameStatus)}</Fact>
        </dl>
      ) : (
        <div role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm">
          <p className="flex items-start gap-1.5 text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Could not check this number with Meta. {n.error?.message}</span>
          </p>
          {n.lastKnown && (n.lastKnown.quality || n.lastKnown.messagingLimit) && (
            <p className="mt-1 text-gray-600">
              Last saved from Meta{n.lastKnown.syncedAt ? ` on ${new Date(n.lastKnown.syncedAt).toLocaleDateString()}` : ''}:
              {' '}{qualityText(n.lastKnown.quality).label}, {tierText(n.lastKnown.messagingLimit)}.
            </p>
          )}
          {n.error?.kind === 'TOKEN_INVALID' && <Link href="/channels" className="font-medium text-teal-700 hover:underline">Reconnect in Channels</Link>}
        </div>
      )}
      {n.lastError && <p className="mt-1.5 text-xs text-gray-500">{n.lastError}</p>}
    </li>
  );
}

/** The overall state shown at the top of the card: connected when at least one Meta number reports CONNECTED. */
export function whatsappHeadline(data: DashboardWhatsAppStatus): { label: string; tone: StatusTone } | null {
  if (!data.connected || data.numbers.length === 0) return null;
  const anyLive = data.numbers.some((n) => (n.live?.numberStatus ?? '').toUpperCase() === 'CONNECTED');
  if (anyLive) return { label: 'Connected', tone: 'success' };
  return data.numbers.some((n) => n.live) ? { label: 'Not connected', tone: 'danger' } : { label: 'Not checked', tone: 'warning' };
}

/** Health of each WhatsApp Business number as Meta reports it, and the phones linked by QR code as VerzChat last recorded them. */
export default function WhatsAppCard({ data, refreshing, onRefresh }: { data: DashboardWhatsAppStatus; refreshing: boolean; onRefresh: () => void }) {
  if (!data.connected && data.qrSessions.length === 0) {
    return (
      <EmptyState title="No WhatsApp number is connected" href="/channels" hrefLabel="Connect WhatsApp">
        Connect a WhatsApp Business number to see its quality rating and messaging limit from Meta.
      </EmptyState>
    );
  }
  return (
    <div className="flex h-full flex-col">
      {data.connected && <ul className="divide-y divide-gray-100">{data.numbers.map((n) => <NumberBlock key={n.id} n={n} />)}</ul>}

      {data.qrSessions.length > 0 && (
        <section aria-labelledby="wa-qr" className={cn(data.connected && 'mt-4 border-t border-gray-100 pt-4')}>
          <h3 id="wa-qr" className="text-sm font-semibold text-gray-900">Phones linked by QR code</h3>
          <p className="text-xs text-gray-500">Not Meta&apos;s official API, so Meta does not report on them.</p>
          <ul className="mt-2 divide-y divide-gray-100">
            {data.qrSessions.map((s) => {
              const tone: StatusTone = s.status === 'CONNECTED' ? 'success' : s.status === 'ERROR' || s.status === 'LOGGED_OUT' ? 'danger' : 'warning';
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 first:pt-0">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">{s.phoneNumber ?? 'Phone not linked yet'}<StatusBadge tone={tone}>{titleCase(s.status)}</StatusBadge></p>
                    {s.lastSeenAt && <p className="text-xs text-gray-500">Last seen {clock(s.lastSeenAt)}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500">{data.connected ? `Checked with Meta at ${clock(data.checkedAt)}` : `Checked at ${clock(data.checkedAt)}`}</p>
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Check with Meta again">
            <RefreshCw size={13} aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />Check again
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <span>QR-connected accounts are reported separately from Meta&apos;s official API status.</span>
          <Link href="/channels" className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline">Account settings<ArrowRight size={12} aria-hidden="true" /></Link>
        </div>
      </div>
    </div>
  );
}
