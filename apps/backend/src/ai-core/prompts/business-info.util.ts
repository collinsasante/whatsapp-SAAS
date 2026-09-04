import { formatHoursSummary, isOffHours, OffHoursDay } from './business-hours.util';

export interface BusinessInfoSettings {
  businessAddress?: string | null;
  businessPhone?: string | null;
  offHoursSchedule?: unknown;
  timezone?: string | null;
}

export interface AdContext {
  adSourceId?: string | null;
  adHeadline?: string | null;
  adImageUrl?: string | null;
}

/**
 * Verz-AI unification, Phase D: renders the business facts that already exist
 * in TenantSettings -- but were never read into any AI prompt before this --
 * as natural sentences a customer could be told, not raw JSON. Sections are
 * omitted individually when the data isn't set, so a tenant that hasn't filled
 * in an address doesn't get a prompt that mentions a blank one.
 */
export function formatBusinessInfoBlock(settings: BusinessInfoSettings, conversation?: AdContext): string {
  const lines: string[] = [];

  if (settings.businessAddress) lines.push(`Address: ${settings.businessAddress}`);
  if (settings.businessPhone) lines.push(`Phone: ${settings.businessPhone}`);

  const schedule = settings.offHoursSchedule as Record<string, OffHoursDay> | undefined;
  const timezone = settings.timezone ?? 'UTC';
  if (schedule && Object.keys(schedule).length > 0) {
    const summary = formatHoursSummary(schedule);
    if (summary) {
      const openRightNow = !isOffHours(schedule, timezone);
      lines.push(`Hours: ${summary} (currently ${openRightNow ? 'open' : 'closed'})`);
    }
  }

  // Real data from WhatsApp's Click-to-WhatsApp-Ads referral payload (messages.service.ts),
  // captured on the conversation whenever it actually originated from an ad click -- lets
  // a "I saw your ad" question sometimes be verified from a real headline instead of always
  // deflecting. Never fabricated: only present when Meta actually sent this on the first message.
  if (conversation?.adHeadline) {
    lines.push(`This conversation started from an ad with the headline: "${conversation.adHeadline}". If the customer mentions seeing an ad, this may be the one they mean -- you can reference it, but only claim pricing/offer details you can otherwise confirm from real product/knowledge-base data, not assume the ad's exact terms.`);
  }

  if (lines.length === 0) return '';
  return `\n\nBUSINESS INFO (use this for location/contact/hours questions -- don't invent anything not listed here):\n${lines.join('\n')}`;
}
