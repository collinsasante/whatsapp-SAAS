import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingCycle, PaymentGateway, SubscriptionStatus } from '@whatsapp-platform/shared-types';
import { InvoiceService } from './invoice.service';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceService: InvoiceService,
  ) {}

  async getSubscription(tenantId: string) {
    return this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
  }

  async getOrCreateFreeTrial(tenantId: string) {
    const existing = await this.getSubscription(tenantId);
    if (existing) return existing;

    const freePlan = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
    if (!freePlan) throw new Error('Free plan not seeded in database');

    const now = new Date();
    return this.prisma.subscription.create({
      data: {
        tenantId,
        planId: freePlan.id,
        status: SubscriptionStatus.ACTIVE,
        cycle: BillingCycle.MONTHLY,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      },
      include: { plan: true },
    });
  }

  async startTrial(tenantId: string, planSlug: string) {
    const plan = await this.prisma.plan.findUnique({ where: { slug: planSlug } });
    if (!plan) throw new NotFoundException(`Plan not found: ${planSlug}`);
    if (plan.trialDays === 0) throw new BadRequestException('This plan does not offer a trial');

    const existing = await this.getSubscription(tenantId);
    if (existing && existing.status !== SubscriptionStatus.EXPIRED && existing.status !== SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Workspace already has an active subscription');
    }

    const now = new Date();
    const trialEnd = new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);

    const sub = await this.prisma.subscription.upsert({
      where: { tenantId },
      update: {
        planId: plan.id,
        status: SubscriptionStatus.TRIAL,
        cycle: BillingCycle.MONTHLY,
        trialEndsAt: trialEnd,
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
      create: {
        tenantId,
        planId: plan.id,
        status: SubscriptionStatus.TRIAL,
        cycle: BillingCycle.MONTHLY,
        trialEndsAt: trialEnd,
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
      },
      include: { plan: true },
    });

    await this.prisma.billingEvent.create({
      data: {
        tenantId,
        event: 'subscription.trial_started',
        data: { planSlug, trialDays: plan.trialDays, trialEndsAt: trialEnd },
        processed: true,
      },
    });

    return sub;
  }

  async createCheckoutInvoice(opts: {
    tenantId: string;
    planSlug: string;
    cycle: BillingCycle;
    gateway: PaymentGateway;
    billingEmail: string;
    billingName: string;
    promoCode?: string;
  }) {
    const plan = await this.prisma.plan.findUnique({ where: { slug: opts.planSlug } });
    if (!plan) throw new NotFoundException(`Plan not found: ${opts.planSlug}`);
    if (plan.monthlyPrice < 0) throw new BadRequestException('Enterprise plan requires custom quote — contact sales');

    let baseAmount = opts.cycle === BillingCycle.YEARLY ? plan.yearlyPrice : plan.monthlyPrice;
    let discount = 0;

    if (opts.promoCode) {
      const promo = await this.prisma.promoCode.findUnique({ where: { code: opts.promoCode.toUpperCase() } });
      if (promo && promo.isActive) {
        const now = new Date();
        const valid = (!promo.validFrom || promo.validFrom <= now) && (!promo.validUntil || promo.validUntil >= now);
        const notExhausted = !promo.maxUses || promo.usedCount < promo.maxUses;
        const applicablePlans = promo.applicablePlans as string[] | null;
        const planApplies = !applicablePlans || applicablePlans.includes(opts.planSlug);

        if (valid && notExhausted && planApplies) {
          discount = promo.discountType === 'PERCENTAGE'
            ? (baseAmount * promo.discountValue) / 100
            : promo.discountValue;
          discount = Math.min(discount, baseAmount);
        }
      }
    }

    const now = new Date();
    const periodEnd = opts.cycle === BillingCycle.YEARLY
      ? new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const invoice = await this.invoiceService.createInvoice({
      tenantId: opts.tenantId,
      planName: plan.name,
      planSlug: opts.planSlug,
      amount: baseAmount,
      discount,
      gateway: opts.gateway,
      billingEmail: opts.billingEmail,
      billingName: opts.billingName,
      periodStart: now,
      periodEnd,
    });

    return { invoice, plan, discount };
  }

  async activateFromPayment(opts: {
    tenantId: string;
    invoiceId: string;
    planId: string;
    cycle: BillingCycle;
    gateway: PaymentGateway;
    gatewayCustomerId?: string;
  }) {
    const now = new Date();
    const periodEnd = opts.cycle === BillingCycle.YEARLY
      ? new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const sub = await this.prisma.subscription.upsert({
      where: { tenantId: opts.tenantId },
      update: {
        planId: opts.planId,
        status: SubscriptionStatus.ACTIVE,
        cycle: opts.cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        gatewayCustomerId: opts.gatewayCustomerId,
      },
      create: {
        tenantId: opts.tenantId,
        planId: opts.planId,
        status: SubscriptionStatus.ACTIVE,
        cycle: opts.cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        gatewayCustomerId: opts.gatewayCustomerId,
      },
      include: { plan: true },
    });

    await this.prisma.billingEvent.create({
      data: {
        tenantId: opts.tenantId,
        event: 'subscription.activated',
        gateway: opts.gateway,
        data: { planId: opts.planId, invoiceId: opts.invoiceId, cycle: opts.cycle },
        processed: true,
      },
    });

    return sub;
  }

  async cancelSubscription(tenantId: string, immediately = false) {
    const sub = await this.getSubscription(tenantId);
    if (!sub) throw new NotFoundException('No active subscription found');

    if (immediately) {
      await this.prisma.subscription.update({
        where: { tenantId },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
      });

      const freePlan = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
      if (freePlan) {
        const now = new Date();
        await this.prisma.subscription.update({
          where: { tenantId },
          data: {
            planId: freePlan.id,
            status: SubscriptionStatus.ACTIVE,
            cycle: BillingCycle.MONTHLY,
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
            cancelAtPeriodEnd: false,
          },
        });
      }
    } else {
      await this.prisma.subscription.update({
        where: { tenantId },
        data: { cancelAtPeriodEnd: true },
      });
    }

    await this.prisma.billingEvent.create({
      data: {
        tenantId,
        event: immediately ? 'subscription.canceled' : 'subscription.cancel_scheduled',
        data: { immediately },
        processed: true,
      },
    });
  }

  async handleExpiredTrials() {
    const now = new Date();
    const expired = await this.prisma.subscription.findMany({
      where: { status: SubscriptionStatus.TRIAL, trialEndsAt: { lte: now } },
      include: { plan: true },
    });

    for (const sub of expired) {
      const freePlan = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
      if (!freePlan) continue;

      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          planId: freePlan.id,
          currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        },
      });

      await this.prisma.billingEvent.create({
        data: {
          tenantId: sub.tenantId,
          event: 'subscription.trial_expired',
          data: { previousPlanSlug: sub.plan.slug },
          processed: true,
        },
      });
    }

    return expired.length;
  }

  async getPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getPlanBySlug(slug: string) {
    return this.prisma.plan.findUnique({ where: { slug } });
  }
}
