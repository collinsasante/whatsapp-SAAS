'use client';
import type { WorkspaceDetail } from '@/lib/admin-api';
import { formatRelative } from '@/lib/admin/format';
import { StatusPill, type PillTone } from '../StatusPill';
import { EmptyState, Unavailable } from '../States';

const TYPE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp (Cloud API)', WHATSAPP_WEB: 'WhatsApp (QR code)', FACEBOOK_MESSENGER: 'Facebook Messenger', INSTAGRAM: 'Instagram',
  TELEGRAM: 'Telegram', TIKTOK: 'TikTok', EMAIL: 'Email', WEB_CHAT: 'Web chat',
};

const STATE: Record<string, { tone: PillTone; label: string }> = {
  no_problems_recorded: { tone: 'success', label: 'No problems recorded' },
  attention: { tone: 'warning', label: 'Needs attention' },
  disconnected: { tone: 'danger', label: 'Disconnected' },
  unknown: { tone: 'neutral', label: 'Not monitored' },
};

const QUALITY: Record<string, PillTone> = { GREEN: 'success', YELLOW: 'warning', RED: 'danger' };

export function TenantChannelsTab({ data }: { data: WorkspaceDetail }) {
  return (
    <div className="space-y-6">
      <Unavailable>Status below comes from what the platform has recorded: connection state, token expiry, webhook verification and recent errors. It does not send a test message, so &quot;No problems recorded&quot; is not proof that delivery works right now.</Unavailable>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Connected channels</h3>
        {data.channels.length === 0 ? <div className="rounded-lg border border-gray-200 bg-white"><EmptyState title="No channels connected" /></div> : (
          <ul className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {data.channels.map((c) => {
              const s = STATE[c.health.state];
              return (
                <li key={c.id} className="p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">{TYPE_LABEL[c.type] ?? c.type}{c.phoneNumber ? ` · ${c.phoneNumber}` : ''} · connected {formatRelative(c.createdAt)}</p>
                    </div>
                    <StatusPill tone={s.tone}>{s.label}</StatusPill>
                  </div>
                  {c.health.reasons.length > 0 && (
                    <ul className="mt-2 text-sm text-gray-700 list-disc pl-5 space-y-0.5">{c.health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">WhatsApp numbers (Cloud API)</h3>
        {data.whatsappNumbers.length === 0 ? <div className="rounded-lg border border-gray-200 bg-white"><EmptyState title="No WhatsApp numbers" /></div> : (
          <ul className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {data.whatsappNumbers.map((n) => (
              <li key={n.id} className="p-3.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{n.label ?? 'Unnamed number'}</p>
                  <p className="text-xs text-gray-500">Messaging limit: {n.messagingLimitTier ?? 'not known'} · quality last checked {n.qualitySyncedAt ? formatRelative(n.qualitySyncedAt) : 'never'}</p>
                </div>
                {n.qualityRating ? <StatusPill tone={QUALITY[n.qualityRating] ?? 'neutral'}>Quality {n.qualityRating.toLowerCase()}</StatusPill> : <StatusPill tone="neutral">Quality not known</StatusPill>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
