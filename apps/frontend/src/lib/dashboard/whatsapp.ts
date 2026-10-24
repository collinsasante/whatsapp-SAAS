/** Plain-words readings of what Meta reports for a WhatsApp number. Unknown values are shown as Meta wrote them. */

export function qualityText(rating: string | null | undefined): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch ((rating ?? '').toUpperCase()) {
    case 'GREEN': return { label: 'High quality', tone: 'success' };
    case 'YELLOW': return { label: 'Medium quality', tone: 'warning' };
    case 'RED': return { label: 'Low quality', tone: 'danger' };
    default: return { label: 'Quality not rated yet', tone: 'neutral' };
  }
}

const TIERS: Record<string, string> = {
  TIER_NOT_SET: 'Not set yet',
  TIER_50: '50 customers a day',
  TIER_250: '250 customers a day',
  TIER_1K: '1,000 customers a day',
  TIER_2K: '2,000 customers a day',
  TIER_10K: '10,000 customers a day',
  TIER_100K: '100,000 customers a day',
  TIER_UNLIMITED: 'Unlimited customers a day',
};

/** Messaging limit tier as a sentence. */
export function tierText(tier: string | null | undefined): string {
  if (!tier) return 'Not reported';
  return TIERS[tier] ?? tier.replace(/_/g, ' ').toLowerCase();
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return 'Not reported';
  const v = value.replace(/_/g, ' ').toLowerCase();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function numberStatusTone(status: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  switch ((status ?? '').toUpperCase()) {
    case 'CONNECTED': return 'success';
    case 'PENDING': case 'MIGRATED': return 'warning';
    case 'DISCONNECTED': case 'FLAGGED': case 'RESTRICTED': case 'BANNED': case 'DELETED': return 'danger';
    default: return 'neutral';
  }
}
