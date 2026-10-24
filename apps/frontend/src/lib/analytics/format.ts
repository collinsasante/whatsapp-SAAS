import type { SeriesPoint } from './types';

/** "Better" and "worse" are about what the metric means, not whether the number went up. */
export type Direction = 'higher-is-better' | 'lower-is-better' | 'neutral';
export type Verdict = 'better' | 'worse' | 'same' | 'unknown';

export interface Delta {
  /** Relative change, or null when there is no baseline to compare with. */
  ratio: number | null;
  verdict: Verdict;
  /** Plain-words label, so the meaning never depends on colour. */
  label: string;
}

const SAME_BAND = 0.005;

export function compare(current: number | null, previous: number | null, direction: Direction): Delta {
  if (current == null || previous == null) return { ratio: null, verdict: 'unknown', label: 'No comparison' };
  if (previous === 0) {
    return current === 0
      ? { ratio: 0, verdict: 'same', label: 'No change' }
      : { ratio: null, verdict: 'unknown', label: 'New this period' };
  }
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < SAME_BAND) return { ratio: 0, verdict: 'same', label: 'No change' };
  const up = ratio > 0;
  const percent = `${Math.round(Math.abs(ratio) * 1000) / 10}%`;
  const word = up ? 'up' : 'down';
  let verdict: Verdict = 'same';
  if (direction === 'higher-is-better') verdict = up ? 'better' : 'worse';
  if (direction === 'lower-is-better') verdict = up ? 'worse' : 'better';
  return { ratio, verdict, label: `${word} ${percent}` };
}

/** Compact duration: "45s", "12 min", "3.4 h", "2.1 d". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return 'n/a';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} d`;
}

export function formatNumber(value: number | null | undefined): string {
  return value == null ? 'n/a' : value.toLocaleString();
}

/** Share as a whole percentage, or "n/a" when the denominator is zero (a rate of nothing is unavailable, not 0%). */
export function formatShare(part: number, whole: number): string {
  if (whole <= 0) return 'n/a';
  return `${Math.round((part / whole) * 100)}%`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

/** "2026-03-09" -> "9 Mar". Parsed as a calendar date so no timezone shift can move it by a day. */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function formatRange(from: string, to: string): string {
  return from === to ? formatDay(from) : `${formatDay(from)} to ${formatDay(to)}`;
}

export function formatWaiting(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

const CHANNEL_NAMES: Record<string, string> = {
  ALL: 'All channels', WHATSAPP: 'WhatsApp', FACEBOOK_MESSENGER: 'Messenger', INSTAGRAM: 'Instagram',
};
export function channelName(channel: string): string {
  return CHANNEL_NAMES[channel] ?? channel;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface TrendPoint {
  date: string;
  label: string;
  opened: number;
  resolved: number;
  newContacts: number;
  inbound: number;
  previousOpened: number;
}

/** Monday of the week containing the given calendar date. */
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const offset = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - offset);
  return dt.toISOString().slice(0, 10);
}

/** Sums daily counts into weeks, keeping the comparison overlay aligned with the weeks it belongs to. */
export function toTrendPoints(series: SeriesPoint[], granularity: 'day' | 'week'): TrendPoint[] {
  if (granularity === 'day') return series.map((p) => ({ ...p, label: formatDay(p.date) }));
  const weeks = new Map<string, TrendPoint>();
  for (const p of series) {
    const key = weekStart(p.date);
    const week = weeks.get(key) ?? { date: key, label: `Week of ${formatDay(key)}`, opened: 0, resolved: 0, newContacts: 0, inbound: 0, previousOpened: 0 };
    week.opened += p.opened;
    week.resolved += p.resolved;
    week.newContacts += p.newContacts;
    week.inbound += p.inbound;
    week.previousOpened += p.previousOpened;
    weeks.set(key, week);
  }
  return [...weeks.values()];
}

/** Escapes a value for CSV, including a guard against spreadsheet formula injection in text cells. */
export function csvCell(value: string | number | null): string {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Array<string | number | null>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

const SOURCE_NAMES: Record<string, string> = {
  organic: 'Direct message',
  ad: 'Click-to-message ad',
  post: 'Post on Facebook or Instagram',
};
/** Friendly name for how a conversation started. Unknown values are shown as written rather than guessed at. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}
