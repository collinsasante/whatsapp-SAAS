/**
 * Turns raw counts into the "attention required" list. Each item corresponds to a condition the system can actually
 * detect from its own records. Items with nothing to report are left out of `items` but kept in `checks`, so the page
 * can say "these 9 things were checked and none needs action" rather than showing an empty box that could mean either.
 */

export type AttentionSeverity = 'critical' | 'warning';

export interface AttentionCounts {
  pastDueSubscriptions: number;
  trialsEndingIn7Days: number;
  failedPayments7d: number;
  openCriticalErrors: number;
  openErrors24h: number;
  failedWebhooks24h: number;
  whatsappNumbersRed: number;
  tenantsOutOfAiCredits: number;
  failedAdminLogins24h: number;
}

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  title: string;
  count: number;
  detail: string;
  href: string;
}

export interface AttentionCheck {
  id: string;
  label: string;
  /** True when the check found nothing that needs action. */
  clear: boolean;
}

/** Failed admin sign-ins below this in a day are ordinary typos, not worth interrupting anyone for. */
export const FAILED_LOGIN_THRESHOLD = 5;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildAttention(c: AttentionCounts): { items: AttentionItem[]; checks: AttentionCheck[] } {
  const defs: Array<AttentionCheck & { item?: Omit<AttentionItem, 'id'>; active: boolean }> = [
    {
      id: 'critical-errors', label: 'Critical errors', clear: c.openCriticalErrors === 0, active: c.openCriticalErrors > 0,
      item: { severity: 'critical', title: plural(c.openCriticalErrors, 'critical error is open', 'critical errors are open'), count: c.openCriticalErrors, detail: 'Logged by the platform and not yet resolved or ignored.', href: '/platform-admin/errors' },
    },
    {
      id: 'past-due', label: 'Past-due subscriptions', clear: c.pastDueSubscriptions === 0, active: c.pastDueSubscriptions > 0,
      item: { severity: 'critical', title: plural(c.pastDueSubscriptions, 'subscription is past due', 'subscriptions are past due'), count: c.pastDueSubscriptions, detail: 'A renewal payment has not succeeded. These tenants are at risk of losing access.', href: '/platform-admin/workspaces?status=past_due' },
    },
    {
      id: 'failed-payments', label: 'Failed payments (7 days)', clear: c.failedPayments7d === 0, active: c.failedPayments7d > 0,
      item: { severity: 'warning', title: plural(c.failedPayments7d, 'payment failed', 'payments failed') + ' in the last 7 days', count: c.failedPayments7d, detail: 'Includes card declines and gateway errors. Some will have been retried successfully.', href: '/platform-admin/billing' },
    },
    {
      id: 'failed-webhooks', label: 'Failed webhooks (24 hours)', clear: c.failedWebhooks24h === 0, active: c.failedWebhooks24h > 0,
      item: { severity: 'warning', title: plural(c.failedWebhooks24h, 'webhook failed', 'webhooks failed') + ' in the last 24 hours', count: c.failedWebhooks24h, detail: 'Payment or messaging events that could not be processed. They can be reprocessed from the webhook page.', href: '/platform-admin/webhooks' },
    },
    {
      id: 'recent-errors', label: 'Errors (24 hours)', clear: c.openErrors24h === 0, active: c.openErrors24h > 0,
      item: { severity: 'warning', title: plural(c.openErrors24h, 'open error', 'open errors') + ' seen in the last 24 hours', count: c.openErrors24h, detail: 'Unresolved errors that occurred again recently.', href: '/platform-admin/errors' },
    },
    {
      id: 'ai-credits', label: 'Tenants out of AI credits', clear: c.tenantsOutOfAiCredits === 0, active: c.tenantsOutOfAiCredits > 0,
      item: { severity: 'warning', title: plural(c.tenantsOutOfAiCredits, 'active tenant has', 'active tenants have') + ' no AI credits left', count: c.tenantsOutOfAiCredits, detail: 'They used Verz AI in the last 14 days and their balance is now zero, so AI replies have stopped for them.', href: '/platform-admin/ai/wallets' },
    },
    {
      id: 'whatsapp-quality', label: 'WhatsApp number quality', clear: c.whatsappNumbersRed === 0, active: c.whatsappNumbersRed > 0,
      item: { severity: 'warning', title: plural(c.whatsappNumbersRed, 'WhatsApp number has', 'WhatsApp numbers have') + ' a red quality rating', count: c.whatsappNumbersRed, detail: 'Meta rates these numbers poorly, which can limit how many messages they may send.', href: '/platform-admin/messaging/whatsapp' },
    },
    {
      id: 'trials-ending', label: 'Trials ending in 7 days', clear: c.trialsEndingIn7Days === 0, active: c.trialsEndingIn7Days > 0,
      item: { severity: 'warning', title: plural(c.trialsEndingIn7Days, 'trial ends', 'trials end') + ' within 7 days', count: c.trialsEndingIn7Days, detail: 'A good moment to check in with these tenants before they decide.', href: '/platform-admin/workspaces?filter=trial_ending_7d' },
    },
    {
      id: 'failed-logins', label: 'Failed admin sign-ins (24 hours)', clear: c.failedAdminLogins24h < FAILED_LOGIN_THRESHOLD, active: c.failedAdminLogins24h >= FAILED_LOGIN_THRESHOLD,
      item: { severity: 'warning', title: plural(c.failedAdminLogins24h, 'failed admin sign-in', 'failed admin sign-ins') + ' in the last 24 hours', count: c.failedAdminLogins24h, detail: 'Could be a mistyped password or someone guessing. Review the sign-in events and the addresses they came from.', href: '/platform-admin/audit-logs?action=auth.login_failed' },
    },
  ];

  return {
    items: defs.filter((d) => d.active && d.item).map((d) => ({ id: d.id, ...(d.item as Omit<AttentionItem, 'id'>) })),
    checks: defs.map(({ id, label, clear }) => ({ id, label, clear })),
  };
}
