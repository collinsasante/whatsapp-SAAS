/** Display helpers for the admin console. */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "3 hours ago", "yesterday", or the date once it is more than a month old. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 0) return formatDateTime(iso);
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 31) return `${days} days ago`;
  return formatDate(iso);
}

export function formatNumber(value: number | null | undefined): string {
  return value == null ? 'n/a' : value.toLocaleString();
}

export function formatGhs(amount: number): string {
  return `GHS ${Math.round(amount).toLocaleString()}`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null) return 'n/a';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Start and end (inclusive, UTC) of a trailing window of `days` days ending today. */
export function trailingRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  return { from: start.toISOString().slice(0, 10), to };
}

/** A relative change as a ratio, or null when there is nothing earlier to compare with. */
export function changeRatio(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return (current - previous) / previous;
}
