import { AttentionCounts, buildAttention, FAILED_LOGIN_THRESHOLD } from './attention.util';

const none: AttentionCounts = {
  pastDueSubscriptions: 0, trialsEndingIn7Days: 0, failedPayments7d: 0, openCriticalErrors: 0, openErrors24h: 0,
  failedWebhooks24h: 0, whatsappNumbersRed: 0, tenantsOutOfAiCredits: 0, failedAdminLogins24h: 0,
};

describe('buildAttention', () => {
  it('reports nothing, and says every check came back clear, when there is nothing to act on', () => {
    const { items, checks } = buildAttention(none);
    expect(items).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(9);
    expect(checks.every((c) => c.clear)).toBe(true);
  });

  it('lists only the conditions that exist, each with a real destination', () => {
    const { items, checks } = buildAttention({ ...none, pastDueSubscriptions: 3, failedWebhooks24h: 1 });
    expect(items.map((i) => i.id).sort()).toEqual(['failed-webhooks', 'past-due']);
    for (const item of items) expect(item.href).toMatch(/^\/platform-admin\//);
    expect(checks.find((c) => c.id === 'past-due')?.clear).toBe(false);
    expect(checks.find((c) => c.id === 'critical-errors')?.clear).toBe(true);
  });

  it('puts the count in the sentence and uses the right singular or plural', () => {
    const one = buildAttention({ ...none, openCriticalErrors: 1 }).items[0];
    const many = buildAttention({ ...none, openCriticalErrors: 4 }).items[0];
    expect(one.title).toBe('1 critical error is open');
    expect(many.title).toBe('4 critical errors are open');
    expect(many.count).toBe(4);
  });

  it('treats open critical errors and past-due subscriptions as critical, and the rest as warnings', () => {
    const { items } = buildAttention({ ...none, openCriticalErrors: 1, pastDueSubscriptions: 1, failedPayments7d: 2, trialsEndingIn7Days: 2 });
    const bySeverity = Object.fromEntries(items.map((i) => [i.id, i.severity]));
    expect(bySeverity['critical-errors']).toBe('critical');
    expect(bySeverity['past-due']).toBe('critical');
    expect(bySeverity['failed-payments']).toBe('warning');
    expect(bySeverity['trials-ending']).toBe('warning');
  });

  it('does not flag a handful of mistyped admin passwords, only a run of them', () => {
    expect(buildAttention({ ...none, failedAdminLogins24h: FAILED_LOGIN_THRESHOLD - 1 }).items).toEqual([]);
    const flagged = buildAttention({ ...none, failedAdminLogins24h: FAILED_LOGIN_THRESHOLD });
    expect(flagged.items[0].href).toBe('/platform-admin/audit-logs?action=auth.login_failed');
    expect(flagged.checks.find((c) => c.id === 'failed-logins')?.clear).toBe(false);
  });
});
