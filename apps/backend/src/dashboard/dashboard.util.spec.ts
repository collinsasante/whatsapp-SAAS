import { hoursRemainingInWindow, isWindowClosingSoon } from './dashboard.util';

describe('dashboard.util', () => {
  const now = new Date('2026-03-15T12:00:00.000Z');

  describe('hoursRemainingInWindow', () => {
    it('returns 24h remaining right when the inbound message just arrived', () => {
      expect(hoursRemainingInWindow(now, now)).toBeCloseTo(24, 5);
    });

    it('returns 3h remaining 21h after the inbound message', () => {
      const lastInboundAt = new Date(now.getTime() - 21 * 60 * 60 * 1000);
      expect(hoursRemainingInWindow(lastInboundAt, now)).toBeCloseTo(3, 5);
    });

    it('returns a negative number once the window has closed', () => {
      const lastInboundAt = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      expect(hoursRemainingInWindow(lastInboundAt, now)).toBeCloseTo(-1, 5);
    });

    it('returns exactly 0 at the instant the window closes', () => {
      const lastInboundAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      expect(hoursRemainingInWindow(lastInboundAt, now)).toBeCloseTo(0, 5);
    });
  });

  describe('isWindowClosingSoon', () => {
    it('is false when more than 4 hours remain', () => {
      const lastInboundAt = new Date(now.getTime() - 19 * 60 * 60 * 1000); // 5h remaining
      expect(isWindowClosingSoon(lastInboundAt, now)).toBe(false);
    });

    it('is true when between 0 and 4 hours remain', () => {
      const lastInboundAt = new Date(now.getTime() - 21 * 60 * 60 * 1000); // 3h remaining
      expect(isWindowClosingSoon(lastInboundAt, now)).toBe(true);
    });

    it('is true right at the 4h boundary', () => {
      const lastInboundAt = new Date(now.getTime() - 20 * 60 * 60 * 1000); // exactly 4h remaining
      expect(isWindowClosingSoon(lastInboundAt, now)).toBe(true);
    });

    it('is false once the window has already closed (do not resurrect stale conversations)', () => {
      const lastInboundAt = new Date(now.getTime() - 25 * 60 * 60 * 1000); // -1h, already closed
      expect(isWindowClosingSoon(lastInboundAt, now)).toBe(false);
    });

    it('respects a custom threshold', () => {
      const lastInboundAt = new Date(now.getTime() - 18 * 60 * 60 * 1000); // 6h remaining
      expect(isWindowClosingSoon(lastInboundAt, now, 8)).toBe(true);
      expect(isWindowClosingSoon(lastInboundAt, now, 4)).toBe(false);
    });
  });
});
