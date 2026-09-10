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

/**
 * Verz-AI unification, Phase O: nothing previously put the current date/time
 * into any prompt at all, so a greeting like "Good morning" was pure model
 * invention with zero grounding -- it would say "Good morning" in the evening
 * just as readily as in the morning. Uses the tenant's own timezone (already
 * used by isOffHours above), falling back to UTC only if the tenant has none
 * configured (TenantSettings.timezone defaults to 'UTC' at the schema level,
 * so this fallback is a defensive belt-and-suspenders, not the expected path).
 */
export function formatCurrentTimeContext(timezone: string): string {
  const now = new Date();
  const hour24 = Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: timezone }).format(now));
  const dayPart = hour24 >= 5 && hour24 < 12 ? 'morning'
    : hour24 >= 12 && hour24 < 17 ? 'afternoon'
    : hour24 >= 17 && hour24 < 21 ? 'evening'
    : 'night';
  const friendly = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
  }).format(now);
  const dayPartNote = dayPart === 'night'
    ? `It's currently ${friendly} (late night/early hours) -- don't force a "good morning/afternoon/evening" greeting; just respond naturally without a time-based greeting.`
    : `It's currently ${friendly} (${dayPart}) -- if you greet the customer, base it on this ("Good ${dayPart}"), never assume a fixed time of day.`;
  return dayPartNote;
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
