import { BadRequestException } from '@nestjs/common';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseOne(value: string, which: 'from' | 'to'): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`"${which}" must be a valid date, for example 2026-10-15.`);
  // A plain date means that whole day: the end of the range is the END of that UTC day, not its first instant
  // (which silently excluded everything that happened on the last day).
  if (which === 'to' && DATE_ONLY.test(value)) return new Date(date.getTime() + DAY_MS - 1);
  return date;
}

/** Validates ?from & ?to. Defaults: to = now, from = 30 days before `to`. */
export function parseDateRange(from: string | undefined, to: string | undefined, now: Date = new Date()): { from: Date; to: Date } {
  const toDate = to ? parseOne(to, 'to') : now;
  const fromDate = from ? parseOne(from, 'from') : new Date(toDate.getTime() - 30 * DAY_MS);
  if (fromDate.getTime() > toDate.getTime()) throw new BadRequestException('"from" must be on or before "to".');
  if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(`The date range cannot be longer than ${MAX_RANGE_DAYS} days.`);
  }
  return { from: fromDate, to: toDate };
}
