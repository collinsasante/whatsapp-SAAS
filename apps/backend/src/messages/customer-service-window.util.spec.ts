import { channelHasCustomerServiceWindow, CUSTOMER_SERVICE_WINDOW_MS as W, isCustomerServiceWindowOpen } from './customer-service-window.util';

describe('customer-service window', () => {
  const now = Date.parse('2026-10-14T12:00:00.000Z');
  it('is open just before, and exactly at, the 24h boundary', () => {
    expect(isCustomerServiceWindowOpen(new Date(now - W + 1), now)).toBe(true);
    expect(isCustomerServiceWindowOpen(new Date(now - W), now)).toBe(true);
  });
  it('is closed just after the boundary', () => {
    expect(isCustomerServiceWindowOpen(new Date(now - W - 1), now)).toBe(false);
  });
  it('is closed for missing or invalid timestamps', () => {
    expect(isCustomerServiceWindowOpen(null, now)).toBe(false);
    expect(isCustomerServiceWindowOpen(undefined, now)).toBe(false);
    expect(isCustomerServiceWindowOpen('not-a-date', now)).toBe(false);
  });
  it('is timezone-independent (ISO strings with offsets)', () => {
    expect(isCustomerServiceWindowOpen('2026-10-13T14:00:00+02:00', now)).toBe(true); // 12:00Z yesterday = exactly 24h
    expect(isCustomerServiceWindowOpen('2026-10-13T13:59:59+02:00', now)).toBe(false);
  });
  it('only WhatsApp Cloud (or legacy no-channel) has the window', () => {
    expect(channelHasCustomerServiceWindow('WHATSAPP')).toBe(true);
    expect(channelHasCustomerServiceWindow(undefined)).toBe(true);
    expect(channelHasCustomerServiceWindow('WHATSAPP_WEB')).toBe(false);
    expect(channelHasCustomerServiceWindow('FACEBOOK_MESSENGER')).toBe(false);
  });
});
