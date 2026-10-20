import { BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';

function build(over: { pack?: Record<string, unknown> | null; plan?: Record<string, unknown> | null; tenantEmail?: string | null; userEmail?: string | null } = {}) {
  const pack = over.pack === undefined ? { slug: 'starter', name: 'Starter', credits: 1000, bonusCredits: 100, priceUsd: 10, priceGhs: 150 } : over.pack;
  const plan = over.plan === undefined
    ? { id: 'p1', slug: 'pro', name: 'Pro', monthlyPrice: 50, paystackPlanCodeMonthly: 'PLN_x', paystackPlanCodeYearly: 'PLN_y', ghsMonthlyPrice: 600, ghsYearlyPrice: 6000 }
    : over.plan;
  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme', billingEmail: over.tenantEmail === undefined ? null : over.tenantEmail }) },
    user: { findFirst: jest.fn().mockResolvedValue(over.userEmail === null ? null : { email: over.userEmail ?? 'owner@acme.test' }) },
    aiCreditPackage: { findFirst: jest.fn().mockResolvedValue(pack) },
    plan: { findUnique: jest.fn().mockResolvedValue(plan) },
    creditPurchase: { create: jest.fn().mockResolvedValue({}) },
    payment: { create: jest.fn().mockResolvedValue({}) },
    invoice: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const paystackGateway = { initializeTransaction: jest.fn().mockResolvedValue({ accessCode: 'ac_1', authorizationUrl: 'https://p/x', gatewayReference: 'REF-1' }) };
  const subscriptionService = { createCheckoutInvoice: jest.fn().mockResolvedValue({ invoice: { id: 'inv1', total: 600, currency: 'GHS' } }) };
  const svc = Object.create(BillingService.prototype) as Record<string, unknown>;
  Object.assign(svc, { prisma, paystackGateway, subscriptionService, config: { get: jest.fn().mockReturnValue('pk_test') } });
  return { svc: svc as unknown as BillingService, prisma, paystackGateway, subscriptionService };
}

describe('AI credit purchase (Paystack)', () => {
  it('charges the pack price in GHS, records the same amount, and returns an access code', async () => {
    const { svc, prisma, paystackGateway } = build();
    const out = await svc.initiatePaystackCreditCheckout('t1', { packSlug: 'starter', billingEmail: 'pay@acme.test' }, 'u1');
    expect(paystackGateway.initializeTransaction).toHaveBeenCalledWith(expect.objectContaining({ email: 'pay@acme.test', amountMajorUnits: 150, currency: 'GHS', tenantId: 't1' }));
    expect(prisma.creditPurchase.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', credits: 1100, amount: 150, currency: 'GHS', status: 'PENDING' });
    expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', amount: 150, currency: 'GHS', status: 'PENDING' });
    expect(out).toMatchObject({ accessCode: 'ac_1', amount: 150, credits: 1100 });
  });

  it('works with no email in the request: falls back to the signed-in user (the reported failure)', async () => {
    const { svc, paystackGateway } = build({ tenantEmail: null });
    await svc.initiatePaystackCreditCheckout('t1', { packSlug: 'starter' }, 'u1');
    expect(paystackGateway.initializeTransaction.mock.calls[0][0].email).toBe('owner@acme.test');
  });

  it('fails clearly, creating no purchase and no charge, when no email can be found anywhere', async () => {
    const { svc, prisma, paystackGateway } = build({ tenantEmail: null, userEmail: null });
    await expect(svc.initiatePaystackCreditCheckout('t1', { packSlug: 'starter' }, 'u1')).rejects.toThrow('Add a billing email');
    expect(paystackGateway.initializeTransaction).not.toHaveBeenCalled();
    expect(prisma.creditPurchase.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown pack and a pack with no GHS price, without contacting the gateway', async () => {
    const a = build({ pack: null });
    await expect(a.svc.initiatePaystackCreditCheckout('t1', { packSlug: 'nope' }, 'u1')).rejects.toThrow(BadRequestException);
    const b = build({ pack: { slug: 'usd-only', credits: 10, bonusCredits: 0, priceUsd: 5, priceGhs: null } });
    await expect(b.svc.initiatePaystackCreditCheckout('t1', { packSlug: 'usd-only' }, 'u1')).rejects.toThrow('not available via Paystack');
    expect(a.paystackGateway.initializeTransaction).not.toHaveBeenCalled();
    expect(b.paystackGateway.initializeTransaction).not.toHaveBeenCalled();
  });

  it('does not record a pending purchase if the gateway refuses to initialize', async () => {
    const { svc, prisma, paystackGateway } = build();
    paystackGateway.initializeTransaction.mockRejectedValueOnce(new Error('gateway down'));
    await expect(svc.initiatePaystackCreditCheckout('t1', { packSlug: 'starter', billingEmail: 'pay@acme.test' }, 'u1')).rejects.toThrow('gateway down');
    expect(prisma.creditPurchase.create).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});

describe('plan upgrade (Paystack)', () => {
  it('charges the cycle\'s GHS price with the matching Paystack plan code, in the caller\'s tenant', async () => {
    const { svc, paystackGateway, prisma } = build({ tenantEmail: 'billing@acme.test' });
    await svc.initiatePaystackCheckout('tenant-A', { planSlug: 'pro', cycle: 'YEARLY' as never }, 'u1');
    expect(paystackGateway.initializeTransaction).toHaveBeenCalledWith(expect.objectContaining({ amountMajorUnits: 6000, currency: 'GHS', planCode: 'PLN_y', tenantId: 'tenant-A' }));
    expect(prisma.payment.create.mock.calls[0][0].data).toMatchObject({ tenantId: 'tenant-A', amount: 6000, currency: 'GHS' });
  });

  it('upgrades with no email typed and none saved: uses the signed-in user\'s email', async () => {
    const { svc, paystackGateway } = build({ tenantEmail: null });
    await svc.initiatePaystackCheckout('t1', { planSlug: 'pro', cycle: 'MONTHLY' as never }, 'u1');
    expect(paystackGateway.initializeTransaction.mock.calls[0][0]).toMatchObject({ email: 'owner@acme.test', planCode: 'PLN_x', amountMajorUnits: 600 });
  });

  it.each([
    ['no GHS price', { ghsMonthlyPrice: null }],
    ['no Paystack plan code', { paystackPlanCodeMonthly: null }],
  ])('says the plan is not provisioned (%s) instead of starting a broken payment', async (_l, patch) => {
    const { svc, paystackGateway, subscriptionService } = build({ plan: { id: 'p1', slug: 'pro', name: 'Pro', monthlyPrice: 50, paystackPlanCodeMonthly: 'PLN_x', ghsMonthlyPrice: 600, ...patch } });
    await expect(svc.initiatePaystackCheckout('t1', { planSlug: 'pro', cycle: 'MONTHLY' as never }, 'u1')).rejects.toThrow('not yet provisioned for Paystack');
    expect(paystackGateway.initializeTransaction).not.toHaveBeenCalled();
    expect(subscriptionService.createCheckoutInvoice).not.toHaveBeenCalled();
  });

  it('an unknown plan is a clear 404, not a server error', async () => {
    const { svc } = build({ plan: null });
    await expect(svc.initiatePaystackCheckout('t1', { planSlug: 'ghost', cycle: 'MONTHLY' as never }, 'u1')).rejects.toThrow('Plan not found');
  });
});
