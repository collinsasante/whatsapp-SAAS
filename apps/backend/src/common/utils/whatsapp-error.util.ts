/**
 * Maps WhatsApp Cloud API message-status error codes to human-readable
 * categories for the analytics failure-breakdown chart.
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export type FailureCategory =
  | 'not_on_whatsapp'
  | 'window_expired'
  | 'template_issue'
  | 'rate_limited'
  | 'account_restricted'
  | 'other';

export const FAILURE_CATEGORY_LABELS: Record<FailureCategory, string> = {
  not_on_whatsapp: 'Not on WhatsApp',
  window_expired: '24-hour window expired',
  template_issue: 'Template quality/rejected',
  rate_limited: 'Rate limited',
  account_restricted: 'Account restricted',
  other: 'Other',
};

const CODE_TO_CATEGORY: Record<number, FailureCategory> = {
  131026: 'not_on_whatsapp',
  1006: 'not_on_whatsapp',
  133010: 'not_on_whatsapp',

  131047: 'window_expired',
  470: 'window_expired',

  132000: 'template_issue',
  132001: 'template_issue',
  132005: 'template_issue',
  132007: 'template_issue',
  132012: 'template_issue',
  132015: 'template_issue',
  132016: 'template_issue',

  130429: 'rate_limited',
  131048: 'rate_limited',
  131056: 'rate_limited',

  368: 'account_restricted',
  131031: 'account_restricted',
  190: 'account_restricted',
};

export function mapWhatsAppErrorCode(code: number | null | undefined): FailureCategory {
  if (code == null) return 'other';
  return CODE_TO_CATEGORY[code] ?? 'other';
}
