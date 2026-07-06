import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BillingCycle, PaymentGateway, PaymentStatus } from '@whatsapp-platform/shared-types';
import { SubscriptionService } from './subscription.service';
import { InvoiceService } from './invoice.service';
import { UsageService } from './usage.service';
import { InitiateCheckoutDto, InitiateCreditCheckoutDto } from './dto/billing.dto';
import { StripeGateway } from './gateways/stripe.gateway';
import { PaystackGateway } from './gateways/paystack.gateway';
import { randomBytes } from 'crypto';

function genRef(prefix: string) {
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly subscriptionService: SubscriptionService,
    private readonly invoiceService: InvoiceService,
    private readonly usageService: UsageService,
    private readonly stripeGateway: StripeGateway,
    private readonly paystackGateway: PaystackGateway,
  ) {}

  async getStatus(tenantId: string) {
    const [tenant, sub] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, billingEmail: true },
      }),
      this.subscriptionService.getOrCreateFreeTrial(tenantId),
    ]);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return { subscription: sub, plan: sub.plan, billingEmail: tenant.billingEmail, workspaceName: tenant.name };
  }

  getUsage(tenantId: string) {
    return this.usageService.getUsageWithLimits(tenantId);
  }

  getInvoices(tenantId: string) {
    return this.invoiceService.getInvoices(tenantId);
  }

  getPlans() {
    return this.subscriptionService.getPlans();
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, billingEmail: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  // ─── Stripe: subscription checkout (embedded Elements) ───────────────────

  async initiateStripeCheckout(tenantId: string, dto: InitiateCheckoutDto) {
    const tenant = await this.requireTenant(tenantId);
    const plan = await this.prisma.plan.findUnique({ where: { slug: dto.planSlug } });
    if (!plan) throw new NotFoundException(`Plan not found: ${dto.planSlug}`);

    if (plan.monthlyPrice === 0) {
      const sub = await this.subscriptionService.getOrCreateFreeTrial(tenantId);
      return { free: true, subscription: sub };
    }

    const priceId = dto.cycle === BillingCycle.YEARLY ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly;
    if (!priceId) throw new BadRequestException(`Plan "${plan.slug}" is not yet provisioned for Stripe`);

    const billingEmail = dto.billingEmail ?? tenant.billingEmail;
    if (!billingEmail) throw new BadRequestException('A billing email is required');

    const existingSub = await this.subscriptionService.getSubscription(tenantId);
    const customerId = await this.stripeGateway.getOrCreateCustomer({
      existingCustomerId: existingSub?.gatewayCustomerId,
      email: billingEmail,
      name: tenant.name,
      tenantId,
    });

    const { invoice } = await this.subscriptionService.createCheckoutInvoice({
      tenantId,
      planSlug: dto.planSlug,
      cycle: dto.cycle,
      gateway: PaymentGateway.STRIPE,
      billingEmail,
      billingName: tenant.name,
      promoCode: dto.promoCode,
    });

    const checkout = await this.stripeGateway.createSubscriptionCheckout({
      customerId,
      priceId,
      tenantId,
      invoiceId: invoice.id,
      planSlug: dto.planSlug,
    });

    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          gateway: PaymentGateway.STRIPE,
          status: PaymentStatus.PENDING,
          amount: invoice.total,
          currency: invoice.currency,
          gatewayPaymentId: checkout.gatewayReference,
          gatewayReference: checkout.gatewayReference,
          metadata: { planSlug: dto.planSlug, cycle: dto.cycle, stripeSubscriptionId: checkout.stripeSubscriptionId },
        },
      }),
      this.prisma.invoice.update({ where: { id: invoice.id }, data: { gatewayInvoiceId: checkout.stripeSubscriptionId } }),
    ]);

    return {
      free: false,
      clientSecret: checkout.clientSecret,
      publishableKey: this.config.get<string>('STRIPE_PUBLISHABLE_KEY', ''),
      amount: invoice.total,
      currency: invoice.currency,
      plan,
    };
  }

  // ─── Paystack: subscription checkout (embedded Inline) ───────────────────

  async initiatePaystackCheckout(tenantId: string, dto: InitiateCheckoutDto) {
    const tenant = await this.requireTenant(tenantId);
    const plan = await this.prisma.plan.findUnique({ where: { slug: dto.planSlug } });
    if (!plan) throw new NotFoundException(`Plan not found: ${dto.planSlug}`);

    if (plan.monthlyPrice === 0) {
      const sub = await this.subscriptionService.getOrCreateFreeTrial(tenantId);
      return { free: true, subscription: sub };
    }

    const planCode = dto.cycle === BillingCycle.YEARLY ? plan.paystackPlanCodeYearly : plan.paystackPlanCodeMonthly;
    const ghsAmount = dto.cycle === BillingCycle.YEARLY ? plan.ghsYearlyPrice : plan.ghsMonthlyPrice;
    if (!planCode || !ghsAmount) throw new BadRequestException(`Plan "${plan.slug}" is not yet provisioned for Paystack`);

    const billingEmail = dto.billingEmail ?? tenant.billingEmail;
    if (!billingEmail) throw new BadRequestException('A billing email is required');

    const { invoice } = await this.subscriptionService.createCheckoutInvoice({
      tenantId,
      planSlug: dto.planSlug,
      cycle: dto.cycle,
      gateway: PaymentGateway.PAYSTACK,
      billingEmail,
      billingName: tenant.name,
      promoCode: dto.promoCode,
    });

    const checkout = await this.paystackGateway.initializeTransaction({
      email: billingEmail,
      amountMajorUnits: ghsAmount,
      currency: 'GHS',
      planCode,
      tenantId,
      invoiceId: invoice.id,
      metadata: { planSlug: dto.planSlug, cycle: dto.cycle },
    });

    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          gateway: PaymentGateway.PAYSTACK,
          status: PaymentStatus.PENDING,
          amount: ghsAmount,
          currency: 'GHS',
          gatewayReference: checkout.gatewayReference,
          metadata: { planSlug: dto.planSlug, cycle: dto.cycle },
        },
      }),
      this.prisma.invoice.update({ where: { id: invoice.id }, data: { gatewayInvoiceId: checkout.gatewayReference } }),
    ]);

    return {
      free: false,
      accessCode: checkout.accessCode,
      reference: checkout.gatewayReference,
      publicKey: this.config.get<string>('PAYSTACK_PUBLIC_KEY', ''),
      amount: ghsAmount,
      currency: 'GHS',
      plan,
    };
  }

  async cancelSubscription(tenantId: string, immediately = false) {
    const sub = await this.subscriptionService.getSubscription(tenantId);
    if (sub?.stripeSubscriptionId) {
      await this.stripeGateway.cancelSubscription(sub.stripeSubscriptionId, immediately).catch((err: unknown) => {
        this.logger.error(`Failed to cancel Stripe subscription: ${(err as Error).message}`);
      });
    }
    return this.subscriptionService.cancelSubscription(tenantId, immediately);
  }

  async updateBillingEmail(tenantId: string, billingEmail: string) {
    return this.prisma.tenant.update({ where: { id: tenantId }, data: { billingEmail } });
  }

  async applyPromoCode(tenantId: string, code: string, planSlug: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { code: code.toUpperCase() } });
    if (!promo || !promo.isActive) throw new NotFoundException('Promo code not found or inactive');

    const now = new Date();
    if (promo.validFrom && promo.validFrom > now) throw new BadRequestException('Promo code not yet active');
    if (promo.validUntil && promo.validUntil < now) throw new BadRequestException('Promo code has expired');
    if (promo.maxUses && promo.usedCount >= promo.maxUses) throw new BadRequestException('Promo code usage limit reached');

    const applicablePlans = promo.applicablePlans as string[] | null;
    if (applicablePlans && !applicablePlans.includes(planSlug)) {
      throw new BadRequestException('Promo code is not valid for this plan');
    }

    const plan = await this.prisma.plan.findUnique({ where: { slug: planSlug } });
    if (!plan) throw new NotFoundException('Plan not found');

    const monthlyDiscount = promo.discountType === 'PERCENTAGE'
      ? (plan.monthlyPrice * promo.discountValue) / 100
      : promo.discountValue;
    const yearlyDiscount = promo.discountType === 'PERCENTAGE'
      ? (plan.yearlyPrice * promo.discountValue) / 100
      : promo.discountValue;

    return {
      code: promo.code, discountType: promo.discountType, discountValue: promo.discountValue,
      monthlyDiscount: Math.min(monthlyDiscount, plan.monthlyPrice),
      yearlyDiscount: Math.min(yearlyDiscount, plan.yearlyPrice),
    };
  }

  async getUsageHistory(tenantId: string) {
    return this.usageService.getHistoricalUsage(tenantId);
  }

  static readonly CREDIT_PACKS = [
    { slug: 'starter-200',  credits: 200,   amount: 5,   label: '200 Credits',   description: 'Great for small teams getting started', currency: 'USD' },
    { slug: 'growth-600',   credits: 600,   amount: 12,  label: '600 Credits',   description: 'Most popular — 3× more value', currency: 'USD' },
    { slug: 'pro-1500',     credits: 1500,  amount: 25,  label: '1,500 Credits', description: 'Best value for active workspaces', currency: 'USD' },
    { slug: 'scale-4000',   credits: 4000,  amount: 55,  label: '4,000 Credits', description: 'High-volume teams', currency: 'USD' },
  ] as const;

  getCreditPacks() {
    return BillingService.CREDIT_PACKS;
  }

  async getAiCredits(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiCredits: true },
    });
    return { credits: tenant?.aiCredits ?? 0 };
  }

  private getCreditPack(packSlug: string) {
    const pack = BillingService.CREDIT_PACKS.find((p) => p.slug === packSlug);
    if (!pack) throw new BadRequestException('Invalid credit pack');
    return pack;
  }

  // ─── Stripe: one-off credit pack purchase ─────────────────────────────────

  async initiateStripeCreditCheckout(tenantId: string, dto: InitiateCreditCheckoutDto) {
    const tenant = await this.requireTenant(tenantId);
    const pack = this.getCreditPack(dto.packSlug);
    const billingEmail = dto.billingEmail ?? tenant.billingEmail;
    if (!billingEmail) throw new BadRequestException('A billing email is required');

    const reference = genRef('VRZ-C');
    const customerId = await this.stripeGateway.getOrCreateCustomer({
      email: billingEmail,
      name: tenant.name,
      tenantId,
    });

    const checkout = await this.stripeGateway.createOneOffPaymentIntent({
      customerId,
      amountMajorUnits: pack.amount,
      currency: pack.currency,
      tenantId,
      metadata: { packSlug: dto.packSlug, reference },
    });

    await this.prisma.$transaction([
      this.prisma.creditPurchase.create({
        data: {
          tenantId, credits: pack.credits, packSlug: dto.packSlug, amount: pack.amount,
          currency: pack.currency, gateway: PaymentGateway.STRIPE, paystackRef: reference, status: PaymentStatus.PENDING,
        },
      }),
      this.prisma.payment.create({
        data: {
          tenantId, gateway: PaymentGateway.STRIPE, status: PaymentStatus.PENDING,
          amount: pack.amount, currency: pack.currency,
          gatewayPaymentId: checkout.gatewayReference, gatewayReference: reference,
        },
      }),
    ]);

    return {
      clientSecret: checkout.clientSecret,
      publishableKey: this.config.get<string>('STRIPE_PUBLISHABLE_KEY', ''),
      amount: pack.amount,
      credits: pack.credits,
      pack,
    };
  }

  // ─── Paystack: one-off credit pack purchase ───────────────────────────────

  async initiatePaystackCreditCheckout(tenantId: string, dto: InitiateCreditCheckoutDto) {
    const tenant = await this.requireTenant(tenantId);
    const pack = this.getCreditPack(dto.packSlug);
    const billingEmail = dto.billingEmail ?? tenant.billingEmail;
    if (!billingEmail) throw new BadRequestException('A billing email is required');

    const checkout = await this.paystackGateway.initializeTransaction({
      email: billingEmail,
      amountMajorUnits: pack.amount,
      currency: pack.currency,
      tenantId,
      metadata: { packSlug: dto.packSlug },
    });

    await this.prisma.$transaction([
      this.prisma.creditPurchase.create({
        data: {
          tenantId, credits: pack.credits, packSlug: dto.packSlug, amount: pack.amount,
          currency: pack.currency, gateway: PaymentGateway.PAYSTACK, paystackRef: checkout.gatewayReference, status: PaymentStatus.PENDING,
        },
      }),
      this.prisma.payment.create({
        data: {
          tenantId, gateway: PaymentGateway.PAYSTACK, status: PaymentStatus.PENDING,
          amount: pack.amount, currency: pack.currency, gatewayReference: checkout.gatewayReference,
        },
      }),
    ]);

    return {
      accessCode: checkout.accessCode,
      reference: checkout.gatewayReference,
      publicKey: this.config.get<string>('PAYSTACK_PUBLIC_KEY', ''),
      amount: pack.amount,
      credits: pack.credits,
      pack,
    };
  }
}
