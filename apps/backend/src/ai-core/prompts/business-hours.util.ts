/**
 * Verz-AI unification, Phase D: extracted verbatim from the legacy responder's
 * private isOffHours() (ai-responder.service.ts) so the on/off auto-reply gate
 * and anything that describes hours to a customer share one implementation --
 * they can never silently drift apart.
 */
export interface OffHoursDay {
  enabled?: boolean;
  start?: string;
  end?: string;
}

export function isOffHours(schedule: Record<string, OffHoursDay>, timezone: string): boolean {
  const now = new Date();
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
    .format(now)
    .toLowerCase();

  const timeStr = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  }).format(now);

  const [currentH, currentM] = timeStr.split(':').map(Number);
  const currentMinutes = currentH * 60 + currentM;

  const day = schedule[dayName];
  if (!day?.enabled) return true;

  const [startH, startM] = (day.start ?? '09:00').split(':').map(Number);
  const [endH, endM] = (day.end ?? '17:00').split(':').map(Number);

  return currentMinutes < (startH * 60 + startM) || currentMinutes >= (endH * 60 + endM);
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** Renders the schedule as a natural sentence a customer could actually be told, e.g.
 * "Mon-Fri 9:00-17:00, closed Sat-Sun" -- collapses consecutive identical days into a range. */
export function formatHoursSummary(schedule: Record<string, OffHoursDay>): string | null {
  const entries = DAY_ORDER.map((d) => ({ day: d, ...schedule[d] }));
  if (entries.every((e) => !e.enabled)) return null;

  const groups: { label: string; days: string[] }[] = [];
  for (const e of entries) {
    const label = e.enabled ? `${e.start ?? '09:00'}-${e.end ?? '17:00'}` : 'closed';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.days.push(e.day);
    else groups.push({ label, days: [e.day] });
  }

  return groups
    .map((g) => {
      const dayRange = g.days.length > 1
        ? `${DAY_LABELS[g.days[0]]}-${DAY_LABELS[g.days[g.days.length - 1]]}`
        : DAY_LABELS[g.days[0]];
      return g.label === 'closed' ? `closed ${dayRange}` : `${dayRange} ${g.label}`;
    })
    .join(', ');
}
