'use client';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { numberStatusTone, qualityText, tierText, titleCase } from '@/lib/dashboard/whatsapp';
import type { DashboardWhatsAppStatus, WhatsAppNumberStatus } from '@/lib/dashboard/types';

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-900">{children}</dd>
    </div>
  );
}

/** What Meta says needs fixing, written as one calm line. Healthy values produce nothing. */
function issuesOf(live: NonNullable<WhatsAppNumberStatus['live']>): string[] {
  const out: string[] = [];
  const verification = (live.verification ?? '').toUpperCase();
  if (verification === 'EXPIRED') out.push('Verification has expired. Verify the number again in Meta Business Manager.');
  else if (verification === 'NOT_VERIFIED') out.push('The number is not verified yet.');
  const name = (live.nameStatus ?? '').toUpperCase();
  if (name === 'DECLINED') out.push('Meta declined the display name. Submit a new one for review.');
  else if (name === 'EXPIRED') out.push('The display name approval has expired.');
  return out;
}

function NumberBlock({ n }: { n: WhatsAppNumberStatus }) {
  const live = n.live;
  const q = qualityText(live?.quality);
  const issues = live ? issuesOf(live) : [];
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm font-semibold text-gray-900">{live?.verifiedName ?? n.label}</p>
        {n.isDefault && <StatusBadge>Default</StatusBadge>}
        {live?.numberStatus && <StatusBadge tone={numberStatusTone(live.numberStatus)}>{titleCase(live.numberStatus)}</StatusBadge>}
      </div>
      {live?.displayPhone && <p className="text-sm text-gray-500">{live.displayPhone}</p>}

      {live ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
          <Fact label="Number quality"><StatusBadge tone={q.tone}>{q.label}</StatusBadge></Fact>
          <Fact label="Messaging limit">{tierText(live.messagingLimit)}</Fact>
          <Fact label="Verification">{titleCase(live.verification)}</Fact>
          <Fact label="Display name">{titleCase(live.nameStatus)}</Fact>
        </dl>
      ) : (
        <div role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm">
          <p className="flex items-start gap-1.5 text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Could not check this number with Meta. {n.error?.message}</span>
          </p>
          {n.lastKnown && (n.lastKnown.quality || n.lastKnown.messagingLimit) && (
            <p className="text-gray-600 mt-1">
              Last saved from Meta{n.lastKnown.syncedAt ? ` on ${new Date(n.lastKnown.syncedAt).toLocaleDateString()}` : ''}:
              {' '}{qualityText(n.lastKnown.quality).label}, {tierText(n.lastKnown.messagingLimit)}.
            </p>
          )}
          {n.error?.kind === 'TOKEN_INVALID' && <Link href="/channels" className="font-medium text-teal-700 hover:underline">Reconnect in Channels</Link>}
        </div>
      )}
      {issues.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Things to fix">
          {issues.map((t) => <li key={t} className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{t}</li>)}
        </ul>
      )}
      {n.lastError && <p className="text-xs text-gray-500 mt-1.5">{n.lastError}</p>}
    </li>
  );
}

/** Health of each WhatsApp Business number as Meta reports it, with the time of the check. */
export default function WhatsAppCard({ data, refreshing, onRefresh }: { data: DashboardWhatsAppStatus; refreshing: boolean; onRefresh: () => void }) {
  return (
    <div className="flex h-full flex-col">
      {!data.connected && data.qrSessions.length === 0 ? (
        <EmptyState title="No WhatsApp number is connected" href="/channels" hrefLabel="Connect WhatsApp">
          Connect a WhatsApp Business number to see its quality rating and messaging limit from Meta.
        </EmptyState>
      ) : (
        <>
          {data.connected && (
            <section aria-labelledby="wa-meta">
              <h3 id="wa-meta" className="text-sm font-semibold text-gray-900">Meta WhatsApp account</h3>
              <p className="mb-1 text-xs text-gray-500">Reported by Meta</p>
              <ul className="mb-3 divide-y divide-gray-100">{data.numbers.map((n) => <NumberBlock key={n.id} n={n} />)}</ul>
            </section>
          )}
          {data.qrSessions.length > 0 && (
            <div className={data.connected ? 'mt-3 pt-3 border-t border-gray-100' : ''}>
              <h3 className="text-sm font-semibold text-gray-900">QR-connected phones</h3>
              <p className="text-xs text-gray-500 mb-1">Not Meta&apos;s official API, so Meta does not report on them. This is the state VerzChat last recorded.</p>
              <ul className="text-sm space-y-1">
                {data.qrSessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 text-gray-800">{s.phoneNumber ?? 'Phone not linked yet'}{s.lastSeenAt && <span className="block text-xs text-gray-500">Last seen {new Date(s.lastSeenAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}</span>
                    <StatusBadge tone={s.status === 'CONNECTED' ? 'success' : s.status === 'ERROR' || s.status === 'LOGGED_OUT' ? 'danger' : 'warning'}>{titleCase(s.status)}</StatusBadge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-auto pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">{data.connected ? `Checked with Meta at ${time(data.checkedAt)}` : `Checked at ${time(data.checkedAt)}`}</p>
            <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing} aria-label="Check with Meta again">
              <RefreshCw size={13} aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />Check again
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
