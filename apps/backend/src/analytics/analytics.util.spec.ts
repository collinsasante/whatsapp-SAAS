import { BadRequestException } from '@nestjs/common';
import { resolveDateRange, previousPeriod, percentChange, MAX_RANGE_DAYS } from './analytics.util';

describe('analytics.util', () => {
  describe('resolveDateRange', () => {
    it('defaults to the last 30 days ending today (tenant timezone) when nothing is provided', () => {
      const { from, to } = resolveDateRange(undefined, undefined, 'Africa/Accra');
      const days = (Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000);
      expect(days).toBe(29); // 30 days inclusive of both endpoints
    });

    it('accepts an explicit from/to pair', () => {
      const { from, to } = resolveDateRange('2026-01-01', '2026-01-10', 'Africa/Accra');
      expect(from).toBe('2026-01-01');
      expect(to).toBe('2026-01-10');
    });

    it('rejects a from after to', () => {
      expect(() => resolveDateRange('2026-02-01', '2026-01-01', 'Africa/Accra')).toThrow(BadRequestException);
    });

    it('rejects a range longer than MAX_RANGE_DAYS', () => {
      expect(() => resolveDateRange('2020-01-01', '2026-01-01', 'Africa/Accra')).toThrow(BadRequestException);
    });

    it(`accepts a range of exactly ${MAX_RANGE_DAYS} days`, () => {
      expect(() => resolveDateRange('2025-01-01', '2026-01-01', 'Africa/Accra')).not.toThrow();
    });

    it('rejects malformed date strings', () => {
      expect(() => resolveDateRange('not-a-date', '2026-01-01', 'Africa/Accra')).toThrow(BadRequestException);
    });
  });

  describe('previousPeriod', () => {
    it('returns the immediately preceding period of equal length', () => {
      const { from, to } = previousPeriod('2026-02-01', '2026-02-10'); // 10-day period
      expect(to).toBe('2026-01-31');
      expect(from).toBe('2026-01-22'); // also 10 days
    });

    it('handles a single-day period', () => {
      const { from, to } = previousPeriod('2026-03-15', '2026-03-15');
      expect(from).toBe('2026-03-14');
      expect(to).toBe('2026-03-14');
    });
  });

  describe('percentChange', () => {
    it('computes a positive percent change', () => {
      expect(percentChange(120, 100)).toBe(20);
    });

    it('computes a negative percent change', () => {
      expect(percentChange(80, 100)).toBe(-20);
    });

    it('returns 0 when both current and previous are 0', () => {
      expect(percentChange(0, 0)).toBe(0);
    });

    it('returns null (undefined growth) when previous is 0 but current is not', () => {
      expect(percentChange(5, 0)).toBeNull();
    });
  });
});
