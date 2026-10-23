/**
 * What the platform can honestly say about a tenant's connected channel, using only what it has recorded. None of
 * this proves a message would be delivered right now; it reports recorded problems. A channel with no recorded
 * problem is "no problems recorded", and one the platform does not monitor is "unknown", never "healthy".
 */

export type ChannelHealthState = 'no_problems_recorded' | 'attention' | 'disconnected' | 'unknown';

export interface ChannelHealth {
  state: ChannelHealthState;
  reasons: string[];
}

export interface ChannelHealthInput {
  type: string;
  isActive: boolean;
  facebookPageConnection?: {
    isActive: boolean;
    webhookVerified: boolean;
    pageAccessTokenExpiresAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
  } | null;
  whatsAppWebSession?: {
    status: string;
    lastSeenAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
  } | null;
  /** Cloud API numbers for this tenant, which carry Meta's own quality rating. */
  whatsappQualityRatings?: Array<string | null>;
}

const RECENT_ERROR_MS = 24 * 60 * 60 * 1000;
const SESSION_STALE_MS = 15 * 60 * 1000;
const MAX_ERROR_LENGTH = 160;

/** Provider error text is shown to an admin, so it is shortened and stripped of anything token-shaped first. */
export function safeErrorText(text: string): string {
  const cleaned = text
    .replace(/(access_token|token|secret|authorization)\s*[=:]\s*\S+/gi, '$1=[removed]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[removed]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > MAX_ERROR_LENGTH ? `${cleaned.slice(0, MAX_ERROR_LENGTH)}…` : cleaned;
}

export function deriveChannelHealth(channel: ChannelHealthInput, now: Date = new Date()): ChannelHealth {
  const reasons: string[] = [];
  const recent = (at: Date | null) => !!at && now.getTime() - at.getTime() < RECENT_ERROR_MS;

  if (channel.type === 'FACEBOOK_MESSENGER' || channel.type === 'INSTAGRAM') {
    const c = channel.facebookPageConnection;
    if (!c) return { state: 'unknown', reasons: ['No page connection is recorded for this channel'] };
    if (!channel.isActive || !c.isActive) return { state: 'disconnected', reasons: ['The page connection is switched off'] };
    if (c.pageAccessTokenExpiresAt && c.pageAccessTokenExpiresAt < now) reasons.push('The page access token has expired');
    if (!c.webhookVerified) reasons.push('Meta has not verified the webhook');
    if (c.lastError && recent(c.lastErrorAt)) reasons.push(`Recent error: ${safeErrorText(c.lastError)}`);
    return { state: reasons.length ? 'attention' : 'no_problems_recorded', reasons };
  }

  if (channel.type === 'WHATSAPP_WEB') {
    const s = channel.whatsAppWebSession;
    if (!s) return { state: 'unknown', reasons: ['No linked-device session is recorded for this channel'] };
    if (s.status !== 'CONNECTED') {
      const why: Record<string, string> = {
        QR_PENDING: 'Waiting for the QR code to be scanned', QR_EXPIRED: 'The QR code expired before it was scanned',
        LOGGED_OUT: 'The phone logged this device out', RECONNECTING: 'Trying to reconnect', ERROR: 'The session is in an error state',
      };
      return { state: s.status === 'RECONNECTING' ? 'attention' : 'disconnected', reasons: [why[s.status] ?? `Session status: ${s.status}`] };
    }
    if (!s.lastSeenAt || now.getTime() - s.lastSeenAt.getTime() > SESSION_STALE_MS) reasons.push('The session has not reported in for over 15 minutes');
    if (s.lastError && recent(s.lastErrorAt)) reasons.push(`Recent error: ${safeErrorText(s.lastError)}`);
    return { state: reasons.length ? 'attention' : 'no_problems_recorded', reasons };
  }

  if (channel.type === 'WHATSAPP') {
    if (!channel.isActive) return { state: 'disconnected', reasons: ['The channel is switched off'] };
    if (channel.whatsappQualityRatings?.includes('RED')) return { state: 'attention', reasons: ["Meta rates a number on this channel's account as red quality"] };
    return { state: 'unknown', reasons: ['Cloud API connections are not tested from here. Only Meta\'s quality rating is checked.'] };
  }

  return { state: 'unknown', reasons: ['This channel type is not monitored'] };
}
