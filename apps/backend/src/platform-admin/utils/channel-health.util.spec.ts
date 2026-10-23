import { deriveChannelHealth, safeErrorText } from './channel-health.util';

const now = new Date('2026-10-20T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 3_600_000;

const page = (over: Partial<NonNullable<Parameters<typeof deriveChannelHealth>[0]['facebookPageConnection']>> = {}) => ({
  isActive: true, webhookVerified: true, pageAccessTokenExpiresAt: null, lastError: null, lastErrorAt: null, ...over,
});

describe('deriveChannelHealth: Messenger and Instagram', () => {
  it('reports "no problems recorded", never "healthy", when nothing is wrong on record', () => {
    expect(deriveChannelHealth({ type: 'INSTAGRAM', isActive: true, facebookPageConnection: page() }, now)).toEqual({ state: 'no_problems_recorded', reasons: [] });
  });
  it('flags an expired token, an unverified webhook and a recent error, each with its own reason', () => {
    const h = deriveChannelHealth({
      type: 'FACEBOOK_MESSENGER', isActive: true,
      facebookPageConnection: page({ pageAccessTokenExpiresAt: ago(HOUR), webhookVerified: false, lastError: 'Invalid OAuth token', lastErrorAt: ago(2 * HOUR) }),
    }, now);
    expect(h.state).toBe('attention');
    expect(h.reasons).toHaveLength(3);
  });
  it('ignores an error from more than a day ago', () => {
    expect(deriveChannelHealth({ type: 'INSTAGRAM', isActive: true, facebookPageConnection: page({ lastError: 'old', lastErrorAt: ago(30 * HOUR) }) }, now).state).toBe('no_problems_recorded');
  });
  it('treats a switched-off connection as disconnected and a missing record as unknown', () => {
    expect(deriveChannelHealth({ type: 'INSTAGRAM', isActive: true, facebookPageConnection: page({ isActive: false }) }, now).state).toBe('disconnected');
    expect(deriveChannelHealth({ type: 'INSTAGRAM', isActive: false, facebookPageConnection: page() }, now).state).toBe('disconnected');
    expect(deriveChannelHealth({ type: 'FACEBOOK_MESSENGER', isActive: true, facebookPageConnection: null }, now).state).toBe('unknown');
  });
});

describe('deriveChannelHealth: WhatsApp by QR code', () => {
  const session = (over: Record<string, unknown> = {}) => ({ status: 'CONNECTED', lastSeenAt: ago(60_000), lastError: null, lastErrorAt: null, ...over });
  it('is fine when connected and recently seen', () => {
    expect(deriveChannelHealth({ type: 'WHATSAPP_WEB', isActive: true, whatsAppWebSession: session() }, now).state).toBe('no_problems_recorded');
  });
  it('is disconnected when logged out or waiting for a scan, and reconnecting needs attention', () => {
    expect(deriveChannelHealth({ type: 'WHATSAPP_WEB', isActive: true, whatsAppWebSession: session({ status: 'LOGGED_OUT' }) }, now)).toMatchObject({ state: 'disconnected', reasons: ['The phone logged this device out'] });
    expect(deriveChannelHealth({ type: 'WHATSAPP_WEB', isActive: true, whatsAppWebSession: session({ status: 'QR_PENDING' }) }, now).state).toBe('disconnected');
    expect(deriveChannelHealth({ type: 'WHATSAPP_WEB', isActive: true, whatsAppWebSession: session({ status: 'RECONNECTING' }) }, now).state).toBe('attention');
  });
  it('flags a connected session that has gone quiet', () => {
    expect(deriveChannelHealth({ type: 'WHATSAPP_WEB', isActive: true, whatsAppWebSession: session({ lastSeenAt: ago(HOUR) }) }, now).state).toBe('attention');
    expect(deriveChannelHealth({ type: 'WHATSAPP_WEB', isActive: true, whatsAppWebSession: session({ lastSeenAt: null }) }, now).state).toBe('attention');
  });
});

describe('deriveChannelHealth: WhatsApp Cloud API and others', () => {
  it('cannot confirm a Cloud API connection, so it says unknown, but does surface a red quality rating', () => {
    expect(deriveChannelHealth({ type: 'WHATSAPP', isActive: true, whatsappQualityRatings: ['GREEN'] }, now).state).toBe('unknown');
    expect(deriveChannelHealth({ type: 'WHATSAPP', isActive: true, whatsappQualityRatings: ['GREEN', 'RED'] }, now).state).toBe('attention');
    expect(deriveChannelHealth({ type: 'WHATSAPP', isActive: false }, now).state).toBe('disconnected');
  });
  it('does not claim to monitor channel types it does not', () => {
    expect(deriveChannelHealth({ type: 'TELEGRAM', isActive: true }, now)).toMatchObject({ state: 'unknown' });
  });
});

describe('safeErrorText', () => {
  it('removes anything shaped like a token and keeps the message short', () => {
    const text = safeErrorText('Invalid access_token=EAAB1234567890abcdefghijklmnopqrstuvwxyz and request failed');
    expect(text).not.toContain('EAAB1234567890');
    expect(text).toContain('access_token=[removed]');
    expect(safeErrorText('x'.repeat(500)).length).toBeLessThanOrEqual(161);
    expect(safeErrorText('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe('[removed]');
  });
});
