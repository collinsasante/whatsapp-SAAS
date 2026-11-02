import { ForbiddenException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';

const PLAN = {
  id: 'p-pro', slug: 'pro', name: 'Pro', monthlyPrice: 25, yearlyPrice: 250, currency: 'USD', ghsMonthlyPrice: 300, ghsYearlyPrice: 3000,
  stripePriceIdMonthly: 'price_m', paystackPlanCodeMonthly: 'PLN_m', limMaxAgents: 20, limMaxContacts: 20000, isActive: true,
};
const SUB = { id: 's1', tenantId: 't1', status: 'ACTIVE', cycle: 'MONTHLY', currentPeriodEnd: '2026-12-01T00:00:00.000Z', plan: PLAN };
const PACKS = [{ slug: 'starter', name: 'Starter', credits: 1000, priceUsd: 10, priceGhs: 150 }];

function build(salesEnabled: boolean) {
  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme', billingEmail: 'b@acme.test', aiCredits: 42 }) },
    plan: { findUnique: jest.fn().mockResolvedValue(PLAN) },
    aiCreditPackage: { findMany: jest.fn().mockResolvedValue(PACKS), findFirst: jest.fn().mockResolvedValue(PACKS[0]) },
  };
  const subscriptionService = {
    getOrCreateFreeTrial: jest.fn().mockResolvedValue(SUB),
    getPlans: jest.fn().mockResolvedValue([PLAN]),
    startTrial: jest.fn().mockResolvedValue({ ok: true }),
    createCheckoutInvoice: jest.fn(),
    getSubscription: jest.fn().mockResolvedValue(SUB),
  };
  const stripeGateway = { createSubscription: jest.fn() };
  const paystackGateway = { initializeTransaction: jest.fn() };
  const aiCreditsService = {};
  const svc = Object.create(BillingService.prototype) as Record<string, unknown>;
  Object.assign(svc, {
    prisma, subscriptionService, stripeGateway, paystackGateway, aiCreditsService,
    config: { get: jest.fn((key: string) => (key === 'SUBSCRIPTION_SALES_ENABLED' && salesEnabled ? 'true' : undefined)) },
  });
  return { svc: svc as unknown as BillingService, prisma, subscriptionService, stripeGateway, paystackGateway };
}

const refused = async (p: Promise<unknown> | unknown) => { try { await p; return undefined; } catch (e) { return e as ForbiddenException; } };

describe('subscription sales switched OFF (the default)', () => {
  it('lists no plans, and never asks the database for them', async () => {
    const { svc, subscriptionService } = build(false);
    expect(await svc.getPlans()).toEqual([]);
    expect(subscriptionService.getPlans).not.toHaveBeenCalled();
  });

  it('shows the workspace its plan, status, limits and renewal date, but no price, currency or gateway id anywhere', async () => {
    const { svc } = build(false);
    const status = await svc.getStatus('t1');
    expect(status.plan).toMatchObject({ name: 'Pro', slug: 'pro', limMaxAgents: 20, limMaxContacts: 20000 });
    expect(status.subscription).toMatchObject({ status: 'ACTIVE', cycle: 'MONTHLY', currentPeriodEnd: SUB.currentPeriodEnd });
    expect(status).toMatchObject({ billingEmail: 'b@acme.test', workspaceName: 'Acme' });
    const text = JSON.stringify(status);
    expect(text).not.toMatch(/monthlyPrice|yearlyPrice|currency|ghsMonthly|ghsYearly|stripePriceId|paystackPlanCode|price_m|PLN_m/);
  });

  it('does not change the stored subscription or plan row when hiding prices', async () => {
    const { svc } = build(false);
    await svc.getStatus('t1');
    expect(PLAN.monthlyPrice).toBe(25);
    expect(SUB.plan).toBe(PLAN);
  });

  it.each([
    ['Stripe subscription checkout', (s: BillingService) => s.initiateStripeCheckout('t1', { planSlug: 'pro', cycle: 'MONTHLY' as never }, 'u1')],
    ['Paystack subscription checkout', (s: BillingService) => s.initiatePaystackCheckout('t1', { planSlug: 'pro', cycle: 'MONTHLY' as never }, 'u1')],
    ['promo code', (s: BillingService) => s.applyPromoCode('t1', 'SAVE10', 'pro')],
    ['free trial', (s: BillingService) => Promise.resolve().then(() => s.startTrial('t1', 'pro'))],
  ])('refuses %s with a clear 403 and touches nothing', async (_name, call) => {
    const { svc, prisma, subscriptionService, stripeGateway, paystackGateway } = build(false);
    const err = await refused(call(svc));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err!.getResponse()).toMatchObject({ code: 'SUBSCRIPTIONS_UNAVAILABLE', message: 'Subscription plans are not available right now.' });
    expect(prisma.plan.findUnique).not.toHaveBeenCalled();
    expect(subscriptionService.startTrial).not.toHaveBeenCalled();
    expect(subscriptionService.createCheckoutInvoice).not.toHaveBeenCalled();
    expect(stripeGateway.createSubscription).not.toHaveBeenCalled();
    expect(paystackGateway.initializeTransaction).not.toHaveBeenCalled();
  });

  describe('AI credits are untouched', () => {
    it('credit packs are still listed with their prices', async () => {
      const { svc } = build(false);
      const packs = await svc.getCreditPacks();
      expect(JSON.stringify(packs)).toContain('"priceUsd":10');
    });

    it('the AI credit balance is still readable', async () => {
      const { svc } = build(false);
      expect(await svc.getAiCredits('t1')).toEqual({ credits: 42 });
    });
  });

  it('the trial route calls the service method (no private-field access), so the switch cannot be bypassed', async () => {
    const billingService = { startTrial: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new BillingController(billingService as never);
    await controller.startTrial('t1', 'pro');
    expect(billingService.startTrial).toHaveBeenCalledWith('t1', 'pro');
  });
});

describe('subscription sales switched ON', () => {
  it('lists the plans and shows prices again', async () => {
    const { svc, subscriptionService } = build(true);
    expect(await svc.getPlans()).toEqual([PLAN]);
    expect(subscriptionService.getPlans).toHaveBeenCalled();
    expect(JSON.stringify(await svc.getStatus('t1'))).toContain('"monthlyPrice":25');
  });

  it('lets a trial start', async () => {
    const { svc, subscriptionService } = build(true);
    await svc.startTrial('t1', 'pro');
    expect(subscriptionService.startTrial).toHaveBeenCalledWith('t1', 'pro');
  });
});
