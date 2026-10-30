export const DEFAULT_REPLY_DEADLINE_MINUTES = 15;
export const MIN_REPLY_DEADLINE_MINUTES = 1;
export const MAX_REPLY_DEADLINE_MINUTES = 24 * 60;

/**
 * Minutes a customer may wait for a person. A workspace with no settings row yet gets the default; a stored null
 * means the owner turned the deadline off.
 */
export function effectiveReplyDeadlineMinutes(settings: { replyDeadlineMinutes: number | null } | null | undefined): number | null {
  if (!settings) return DEFAULT_REPLY_DEADLINE_MINUTES;
  return settings.replyDeadlineMinutes;
}

/** The moment a request made at `from` becomes overdue, or null when no deadline applies. */
export function replyDeadlineAt(from: Date, minutes: number | null): Date | null {
  return minutes == null ? null : new Date(from.getTime() + minutes * 60_000);
}
