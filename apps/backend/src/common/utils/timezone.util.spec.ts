import { getOffsetMinutes, getTenantDayBoundaries, getTenantDateRangeBoundaries, toTenantDateString, enumerateTenantDates } from './timezone.util';

describe('timezone.util', () => {
  describe('getOffsetMinutes', () => {
    it('is 0 for Africa/Accra (UTC+0, no DST) year-round', () => {
      expect(getOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Africa/Accra')).toBe(0);
      expect(getOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Africa/Accra')).toBe(0);
    });

    it('reflects UTC-5 for America/New_York in January (EST, no DST)', () => {
      expect(getOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    });

    it('reflects UTC-4 for America/New_York in July (EDT, DST active)', () => {
      expect(getOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
    });
  });

  describe('getTenantDayBoundaries', () => {
    it('for Africa/Accra, local midnight equals UTC midnight (no offset)', () => {
      const { start, end } = getTenantDayBoundaries('2026-03-10', 'Africa/Accra');
      expect(start.toISOString()).toBe('2026-03-10T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-03-11T00:00:00.000Z');
    });

    it('for America/New_York, local midnight is 5 hours after UTC midnight in January (EST)', () => {
      const { start, end } = getTenantDayBoundaries('2026-01-10', 'America/New_York');
      expect(start.toISOString()).toBe('2026-01-10T05:00:00.000Z');
      expect(end.toISOString()).toBe('2026-01-11T05:00:00.000Z');
    });

    it('boundary case: a message at 23:58 Africa/Accra local time lands in the correct calendar day', () => {
      // 23:58 Accra local (UTC+0) on 2026-03-10 == 2026-03-10T23:58:00Z
      const messageAt = new Date('2026-03-10T23:58:00Z');
      const { start: dayStart, end: dayEnd } = getTenantDayBoundaries('2026-03-10', 'Africa/Accra');
      expect(messageAt.getTime()).toBeGreaterThanOrEqual(dayStart.getTime());
      expect(messageAt.getTime()).toBeLessThan(dayEnd.getTime());

      // and must NOT fall into the next day's bucket
      const { start: nextDayStart } = getTenantDayBoundaries('2026-03-11', 'Africa/Accra');
      expect(messageAt.getTime()).toBeLessThan(nextDayStart.getTime());
    });

    it('boundary case: a message at 23:58 America/Accra-equivalent offset lands in the correct day even when UTC date differs', () => {
      // 23:58 EST (America/New_York) on 2026-01-10 is 04:58 UTC on 2026-01-11 --
      // a naive UTC-day bucketing would misfile this into the wrong tenant day.
      const localMidnightEve = getTenantDayBoundaries('2026-01-10', 'America/New_York');
      const messageAt = new Date(localMidnightEve.end.getTime() - 2 * 60 * 1000); // 23:58 local
      expect(messageAt.toISOString()).toBe('2026-01-11T04:58:00.000Z');

      const { start: correctDayStart, end: correctDayEnd } = getTenantDayBoundaries('2026-01-10', 'America/New_York');
      expect(messageAt.getTime()).toBeGreaterThanOrEqual(correctDayStart.getTime());
      expect(messageAt.getTime()).toBeLessThan(correctDayEnd.getTime());
    });

    it('rejects malformed date strings', () => {
      expect(() => getTenantDayBoundaries('10-03-2026', 'Africa/Accra')).toThrow();
      expect(() => getTenantDayBoundaries('2026/03/10', 'Africa/Accra')).toThrow();
    });
  });

  describe('getTenantDateRangeBoundaries', () => {
    it('spans from the start of `from` to the end of `to`', () => {
      const { start, end } = getTenantDateRangeBoundaries('2026-03-01', '2026-03-03', 'Africa/Accra');
      expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-03-04T00:00:00.000Z');
    });
  });

  describe('toTenantDateString', () => {
    it('formats a UTC instant as the correct local calendar date', () => {
      // 2026-01-11T04:58:00Z is still 2026-01-10 in America/New_York (EST, UTC-5)
      expect(toTenantDateString(new Date('2026-01-11T04:58:00Z'), 'America/New_York')).toBe('2026-01-10');
      expect(toTenantDateString(new Date('2026-01-11T04:58:00Z'), 'Africa/Accra')).toBe('2026-01-11');
    });
  });

  describe('enumerateTenantDates', () => {
    it('lists every date inclusive of both endpoints', () => {
      expect(enumerateTenantDates('2026-02-27', '2026-03-02')).toEqual([
        '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02',
      ]);
    });

    it('returns a single-element array when from === to', () => {
      expect(enumerateTenantDates('2026-05-01', '2026-05-01')).toEqual(['2026-05-01']);
    });
  });
});
