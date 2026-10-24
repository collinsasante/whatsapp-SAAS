import { BadRequestException } from '@nestjs/common';
import { toTenantDateString } from '../common/utils/timezone.util';

export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;

/** Resolves and validates a from/to query pair into concrete YYYY-MM-DD dates (in the tenant's timezone). */
export function resolveDateRange(fromStr: string | undefined, toStr: string | undefined, timezone: string): { from: string; to: string } {
  const today = toTenantDateString(new Date(), timezone);
  const to = toStr ?? today;

  if (toStr && Number.isNaN(Date.parse(toStr))) throw new BadRequestException('Invalid "to" date');
  if (fromStr && Number.isNaN(Date.parse(fromStr))) throw new BadRequestException('Invalid "from" date');

  const from = fromStr ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));

  if (from > to) throw new BadRequestException('"from" must be before or equal to "to"');

  const rangeDays = daysBetween(from, to) + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new BadRequestException(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  return { from, to };
}

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'custom';

/** Resolves a preset relative to "today" in the tenant's timezone, so presets match the dates the data is bucketed by. */
export function resolvePreset(preset: Exclude<RangePreset, 'custom'>, timezone: string): { from: string; to: string } {
  const to = toTenantDateString(new Date(), timezone);
  const days = preset === 'today' ? 1 : preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  return { from: addDays(to, -(days - 1)), to };
}

/** Number of calendar days in an inclusive [from, to] range. */
export function daysInRange(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

/** The equal-length period immediately preceding [from, to] -- for "% change vs previous period" comparisons. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const rangeDays = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(rangeDays - 1));
  return { from: prevFrom, to: prevTo };
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null; // undefined growth from a zero baseline
  return Math.round(((current - previous) / previous) * 1000) / 10; // one decimal place
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}
