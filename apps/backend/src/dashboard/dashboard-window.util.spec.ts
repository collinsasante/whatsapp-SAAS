import { BadRequestException } from '@nestjs/common';
import { resolveDashboardWindow, trendBuckets, DASHBOARD_MAX_DAYS } from './dashboard-window.util';

describe('resolveDashboardWindow', () => {
  it('defaults to the last 7 days with an equal-length previous period', () => {
    const w = resolveDashboardWindow({}, 'Africa/Accra');
    expect(w.days).toBe(7);
    expect(w.granularity).toBe('day');
    const span = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000 + 1;
    expect(span(w.previousFrom, w.previousTo)).toBe(7);
    expect(Date.parse(w.to) - Date.parse(w.previousTo)).toBe(7 * 86_400_000);
  });

  it('uses hourly buckets for a single day', () => {
    const w = resolveDashboardWindow({ preset: 'today' }, 'Africa/Accra');
    expect(w.days).toBe(1);
    expect(w.granularity).toBe('hour');
    expect(trendBuckets(w)).toHaveLength(24);
    expect(trendBuckets(w)[0]).toBe(`${w.from} 00`);
  });

  it('accepts a custom range and enumerates one bucket per day', () => {
    const w = resolveDashboardWindow({ preset: 'custom', from: '2026-03-01', to: '2026-03-10' }, 'UTC');
    expect(w.days).toBe(10);
    expect(w.previousFrom).toBe('2026-02-19');
    expect(w.previousTo).toBe('2026-02-28');
    expect(trendBuckets(w)).toHaveLength(10);
  });

  it('handles a leap day when computing the previous period', () => {
    const w = resolveDashboardWindow({ from: '2028-03-01', to: '2028-03-03' }, 'UTC');
    expect(w.previousFrom).toBe('2028-02-27');
    expect(w.previousTo).toBe('2028-02-29');
  });

  it('rejects a custom range with a missing end', () => {
    expect(() => resolveDashboardWindow({ preset: 'custom', from: '2026-03-01' }, 'UTC')).toThrow(BadRequestException);
    expect(() => resolveDashboardWindow({ to: '2026-03-01' }, 'UTC')).toThrow(BadRequestException);
  });

  it('rejects reversed and over-long ranges', () => {
    expect(() => resolveDashboardWindow({ from: '2026-03-10', to: '2026-03-01' }, 'UTC')).toThrow(BadRequestException);
    expect(() => resolveDashboardWindow({ from: '2026-01-01', to: '2026-12-31' }, 'UTC')).toThrow(/cannot exceed/);
    const ok = resolveDashboardWindow({ from: '2026-01-01', to: '2026-04-02' }, 'UTC');
    expect(ok.days).toBe(DASHBOARD_MAX_DAYS);
  });
});
