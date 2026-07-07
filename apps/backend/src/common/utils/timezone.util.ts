/**
 * Timezone-aware day-boundary math for analytics rollups.
 *
 * Approach: compute the IANA timezone's UTC offset at a nearby instant (via
 * Intl.DateTimeFormat, no external tz library needed), then shift UTC
 * midnight by that offset. This is exact for all timezones except the rare
 * case of a DST transition landing inside the offset-magnitude window
 * between UTC midnight and true local midnight -- acceptable for analytics
 * day-bucketing, which doesn't need sub-hour precision.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDateString(dateStr: string): void {
  if (!DATE_RE.test(dateStr)) {
    throw new Error(`Expected a YYYY-MM-DD date string, got: ${dateStr}`);
  }
}

/** Offset (in minutes) of `timezone` from UTC at the given instant. Positive = east of Greenwich. */
export function getOffsetMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;

  // formatToParts can report hour="24" for midnight in hour12:false mode on some engines
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const asUtcIfLocalWereUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return Math.round((asUtcIfLocalWereUtc - date.getTime()) / 60000);
}

/** The [start, end) UTC instant range spanning one calendar day in `timezone`. */
export function getTenantDayBoundaries(dateStr: string, timezone: string): { start: Date; end: Date } {
  assertDateString(dateStr);
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcGuess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetMin = getOffsetMinutes(utcGuess, timezone);
  const start = new Date(utcGuess.getTime() - offsetMin * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** The [start, end) UTC instant range spanning `fromDateStr` through the end of `toDateStr`, inclusive, in `timezone`. */
export function getTenantDateRangeBoundaries(fromDateStr: string, toDateStr: string, timezone: string): { start: Date; end: Date } {
  const { start } = getTenantDayBoundaries(fromDateStr, timezone);
  const { end } = getTenantDayBoundaries(toDateStr, timezone);
  return { start, end };
}

/** Formats a UTC instant as the YYYY-MM-DD calendar date it falls on in `timezone`. */
export function toTenantDateString(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Every calendar date string (YYYY-MM-DD, in `timezone`) from `fromDateStr` to `toDateStr` inclusive. */
export function enumerateTenantDates(fromDateStr: string, toDateStr: string): string[] {
  assertDateString(fromDateStr);
  assertDateString(toDateStr);
  const dates: string[] = [];
  const [fy, fm, fd] = fromDateStr.split('-').map(Number);
  const [ty, tm, td] = toDateStr.split('-').map(Number);
  const cursor = new Date(Date.UTC(fy, fm - 1, fd));
  const last = new Date(Date.UTC(ty, tm - 1, td));
  while (cursor.getTime() <= last.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
