import { BadRequestException } from '@nestjs/common';
import { enumerateTenantDates } from '../common/utils/timezone.util';
import { daysInRange, previousPeriod, resolveDateRange, resolvePreset } from '../analytics/analytics.util';
import type { DashboardRangeQueryDto } from './dto/dashboard-command.dto';

/** The dashboard is a "what is happening now" view; longer histories belong in Analytics. */
export const DASHBOARD_MAX_DAYS = 92;

export interface DashboardWindow {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  days: number;
  granularity: 'hour' | 'day';
}

/** Resolves the requested range (default: last 7 days) in the workspace timezone, with the equal-length period before it. */
export function resolveDashboardWindow(query: DashboardRangeQueryDto, timezone: string): DashboardWindow {
  let range: { from: string; to: string };
  if (query.preset && query.preset !== 'custom') {
    range = resolvePreset(query.preset, timezone);
  } else if (query.preset === 'custom' || query.from || query.to) {
    if (!query.from || !query.to) throw new BadRequestException('A custom range needs both "from" and "to"');
    range = resolveDateRange(query.from, query.to, timezone);
  } else {
    range = resolvePreset('7d', timezone);
  }
  const days = daysInRange(range.from, range.to);
  if (days > DASHBOARD_MAX_DAYS) throw new BadRequestException(`The dashboard range cannot exceed ${DASHBOARD_MAX_DAYS} days`);
  const prev = previousPeriod(range.from, range.to);
  return { ...range, previousFrom: prev.from, previousTo: prev.to, days, granularity: days === 1 ? 'hour' : 'day' };
}

/** Bucket labels for the trend chart: one per day, or one per hour of a single day. */
export function trendBuckets(window: Pick<DashboardWindow, 'from' | 'to' | 'granularity'>): string[] {
  if (window.granularity === 'day') return enumerateTenantDates(window.from, window.to);
  return Array.from({ length: 24 }, (_, h) => `${window.from} ${String(h).padStart(2, '0')}`);
}
