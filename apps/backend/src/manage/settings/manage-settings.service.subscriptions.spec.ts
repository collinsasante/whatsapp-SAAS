import { ForbiddenException } from '@nestjs/common';
import { ManageSettingsService } from './manage-settings.service';

function build(over: { sub?: unknown; credits?: number } = {}) {
  const prisma = {
    subscription: { findUnique: jest.fn().mockResolvedValue(over.sub === undefined ? { status: 'ACTIVE', plan: { monthlyPrice: 25 } } : over.sub) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme', aiCredits: over.credits ?? 500 }) },
    tenantSettings: { upsert: jest.fn().mockResolvedValue({ aiEnabled: true }) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', name: 'Ama', email: 'ama@acme.test' }]) },
  };
  const notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };
  const email = { sendRaw: jest.fn().mockResolvedValue(undefined) };
  const service = new ManageSettingsService(prisma as never, notifications as never, email as never, { getJob: jest.fn(), add: jest.fn() } as never);
  return { service, prisma, notifications, email };
}

describe('subscription expiry notice (no purchase prompt)', () => {
  it('still tells the workspace admins what happened, in the app and by email', async () => {
    const { service, notifications, email } = build();
    await service.notifySubscriptionDowngraded('t1');
    expect(notifications.notifyUser).toHaveBeenCalledWith('a1', 't1', expect.objectContaining({ title: 'Plan downgraded to Free' }));
    const mail = email.sendRaw.mock.calls[0][0];
    expect(mail.to).toBe('ama@acme.test');
    expect(mail.subject).toBe('Your Acme subscription has expired');
    expect(mail.html).toContain('has expired and access has been downgraded to the <strong>Free plan</strong>');
    expect(mail.html).toContain('You can still send and receive messages');
  });

  it('the email has no renew, upgrade, subscribe or buy button, no billing link and no price', async () => {
    const { service, email } = build();
    await service.notifySubscriptionDowngraded('t1');
    const html: string = email.sendRaw.mock.calls[0][0].html;
    expect(html).not.toMatch(/renew|upgrade|subscribe now|buy|choose a plan|checkout/i);
    expect(html).not.toMatch(/AI agent paused/i); // AI is governed by credits, not by the plan
    expect(html).not.toContain('/billing');
    expect(html).not.toMatch(/<a /i);
    expect(html).not.toMatch(/\$\s?\d|\/mo\b|per month/i);
  });
});

describe('VerzAI activation needs approval only: no subscription and no credit balance', () => {
  const SUBSCRIPTIONS: Array<[string, unknown]> = [
    ['no subscription record at all', null],
    ['the free plan', { status: 'ACTIVE', plan: { monthlyPrice: 0 } }],
    ['an expired trial', { status: 'TRIAL', plan: { monthlyPrice: 25 } }],
    ['a cancelled paid plan', { status: 'CANCELED', plan: { monthlyPrice: 25 } }],
    ['an active paid plan', { status: 'ACTIVE', plan: { monthlyPrice: 25 } }],
  ];
  const ACTIVATION = {
    where: { tenantId: 't1' },
    create: { tenantId: 't1', aiEnabled: true, aiTrialApprovedAt: expect.any(Date) },
    update: { aiEnabled: true, aiTrialApprovedAt: expect.any(Date) },
  };

  it.each(SUBSCRIPTIONS)('activates with %s, at zero credits', async (_label, sub) => {
    const { service, prisma } = build({ sub, credits: 0 });
    await service.approveAi('t1');
    expect(prisma.tenantSettings.upsert).toHaveBeenCalledWith(ACTIVATION);
  });

  it.each([0, 1, 500])('activates identically whatever the balance is (%s credits)', async (credits) => {
    const { service, prisma } = build({ credits });
    await service.approveAi('t1');
    expect(prisma.tenantSettings.upsert).toHaveBeenCalledWith(ACTIVATION);
  });

  it('looks at neither the subscription nor the credit balance', async () => {
    const { service, prisma } = build({ sub: null, credits: 0 });
    await service.approveAi('t1');
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('activating changes only the AI switches: the credit balance and the stored subscription are left exactly as they were', async () => {
    const { service, prisma } = build({ sub: { status: 'ACTIVE', plan: { monthlyPrice: 25 } }, credits: 321 });
    await service.approveAi('t1');
    expect((prisma.tenant as Record<string, jest.Mock>)['update']).toBeUndefined();
    expect((prisma.subscription as Record<string, jest.Mock>)['update']).toBeUndefined();
    expect(prisma.tenantSettings.upsert.mock.calls[0][0].update).toEqual({ aiEnabled: true, aiTrialApprovedAt: expect.any(Date) });
  });

  it('the readiness email and notification do not say credits (or a plan) are needed to activate', async () => {
    const { service, email, notifications } = build();
    await service.notifyAiTrialExpired('t1');
    const html: string = email.sendRaw.mock.calls[0][0].html;
    expect(html).toContain('Approve it in your AI settings to activate it');
    expect(html).toContain('Replies are charged against');
    expect(html).not.toMatch(/you need|needs? (?:an? )?(?:active )?(?:paid plan|AI credits)|subscription|upgrade|monthly/i);
    expect(JSON.stringify(notifications.notifyUser.mock.calls)).not.toMatch(/paid plan|subscription|credits are required/i);
  });
});
