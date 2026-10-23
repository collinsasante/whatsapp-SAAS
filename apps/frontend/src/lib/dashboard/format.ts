import type { Delta } from '@/lib/analytics/format';
import type { DashboardPreset, DashboardRange } from './types';

export const DASHBOARD_MAX_DAYS = 92;
export const DEFAULT_PRESET: DashboardPreset = '7d';
export const PRESET_KEYS: DashboardPreset[] = ['today', '7d', '30d', 'custom'];

export function isoToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Query sent to every widget endpoint. Presets are resolved by the server in the workspace timezone. */
export function rangeQuery(range: DashboardRange): { preset: string; from?: string; to?: string } {
  return range.preset === 'custom' ? { preset: 'custom', from: range.from, to: range.to } : { preset: range.preset };
}

export function rangeKey(range: DashboardRange): string {
  return range.preset === 'custom' ? `custom:${range.from}:${range.to}` : range.preset;
}

/** Link to the matching section of Analytics for the same range. */
export function analyticsHref(range: DashboardRange, section: string): string {
  const params = new URLSearchParams({ range: range.preset });
  if (range.preset === 'custom') { params.set('from', range.from); params.set('to', range.to); }
  return `/analytics?${params.toString()}#${section}`;
}

export function greeting(timezone: string | undefined, now = new Date()): string {
  let hour = now.getHours();
  if (timezone) {
    try {
      hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: timezone }).format(now)) % 24;
    } catch { /* an unknown timezone falls back to the browser clock */ }
  }
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "just now", "4 min ago", "2 h ago". */
export function freshness(iso: string, now = Date.now()): { text: string; stale: boolean } {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const stale = seconds > 15 * 60;
  if (seconds < 45) return { text: 'just now', stale };
  if (seconds < 3600) return { text: `${Math.round(seconds / 60)} min ago`, stale };
  return { text: `${Math.round(seconds / 3600)} h ago`, stale };
}

/** Change in a percentage, in points: "up 5 points" reads more honestly than "up 10%" for a rate. */
export function pointsDelta(current: number | null, previous: number | null, higherIsBetter = true): Delta {
  if (current == null || previous == null) return { ratio: null, verdict: 'unknown', label: 'No comparison' };
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { ratio: 0, verdict: 'same', label: 'No change' };
  const up = diff > 0;
  const better = higherIsBetter ? up : !up;
  return { ratio: diff, verdict: better ? 'better' : 'worse', label: `${up ? 'up' : 'down'} ${Math.abs(diff)} points` };
}

/** "2026-03-10 14" -> "14:00", "2026-03-10" -> "10 Mar". Calendar dates are parsed without a timezone shift. */
export function bucketLabel(bucket: string, granularity: 'hour' | 'day'): string {
  if (granularity === 'hour') return `${bucket.slice(11, 13)}:00`;
  const [y, m, d] = bucket.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function periodWord(range: DashboardRange): string {
  return range.preset === 'today' ? 'yesterday' : 'the previous period';
}
