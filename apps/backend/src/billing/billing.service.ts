import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BillingCycle, PaymentGateway, PaymentStatus } from '@whatsapp-platform/shared-types';
import { SubscriptionService } from './subscription.service';
import { InvoiceService } from './invoice.service';
import { UsageService } from './usage.service';
import { StripeGateway } from './gateways/stripe.gateway';
import { PaystackGateway } from './gateways/paystack.gateway';
import { FlutterwaveGateway } from './gateways/flutterwave.gateway';
import { IBillingGateway } from './gateways/gateway.interface';
import { InitiateCheckoutDto } from './dto/billing.dto';

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
    private readonly flutterwaveGateway: FlutterwaveGateway,
  ) {}

  private getGateway(gateway: PaymentGateway): IBillingGateway {
    switch (gateway) {
      case PaymentGateway.STRIPE:      return this.stripeGateway;
      case PaymentGateway.PAYSTACK:    return this.paystackGateway;
      case PaymentGateway.FLUTTERWAVE: return this.flutterwaveGateway;
      default: throw new BadRequestException(`Unsupported gateway: ${gateway}`);
    }
  }

  async getStatus(tenantId: string) {
    const [tenant, sub] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, billingEmail: true },
      }),
      this.subscriptionService.getOrCreateFreeTrial(tenantId),
    ]);
    if (!tenant) throw new NotFoundException('Tenant not found');

    return {
      subscription: sub,
      plan: sub.plan,
      billingEmail: tenant.billingEmail,
      workspaceName: tenant.name,
    };
  }

  async getUsage(tenantId: string) {
    return this.usageService.getUsageWithLimits(tenantId);
  }

  async getInvoices(tenantId: string) {
    return this.invoiceService.getInvoices(tenantId);
  }

  async getPlans() {
    return this.subscriptionService.getPlans();
  }

  async initiateCheckout(tenantId: string, dto: InitiateCheckoutDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, billingEmail: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const billingEmail = dto.billingEmail ?? tenant.billingEmail ?? '';
    if (!billingEmail) throw new BadRequestException('Billing email is required');

    const { invoice, plan } = await this.subscriptionService.createCheckoutInvoice({
      tenantId,
      planSlug: dto.planSlug,
      cycle: dto.cycle,
      gateway: dto.gateway,
      billingEmail,
      billingName: tenant.name,
      promoCode: dto.promoCode,
    });

    if (invoice.total === 0) {
      // Free plan or fully discounted — activate immediately
      await this.invoiceService.markPaid(invoice.id);
      await this.subscriptionService.activateFromPayment({
        tenantId,
        invoiceId: invoice.id,
        planId: plan.id,
        cycle: dto.cycle,
        gateway: dto.gateway,
      });
      return { invoice, paymentUrl: null, free: true };
    }

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const gw = this.getGateway(dto.gateway);

    // Stripe requires USD; convert GHS plan prices to their USD equivalent
    const chargeAmount = dto.gateway === PaymentGateway.STRIPE && invoice.currency === 'GHS'
      ? Math.round((invoice.total / 150) * 12 * 100) / 100
      : invoice.total;
    const chargeCurrency = dto.gateway === PaymentGateway.STRIPE && invoice.currency === 'GHS'
      ? 'USD'
      : invoice.currency;

    const session = await gw.createCheckoutSession({
      tenantId,
      planSlug: dto.planSlug,
      amount: chargeAmount,
      currency: chargeCurrency,
      billingEmail,
      billingName: tenant.name,
      invoiceId: invoice.id,
      successUrl: `${frontendUrl}/billing?payment=success&invoice=${invoice.id}`,
      cancelUrl: `${frontendUrl}/billing?payment=cancelled`,
      metadata: { planId: plan.id, cycle: dto.cycle },
    });

    await this.invoiceService.setGatewayPaymentUrl(invoice.id, session.paymentUrl, session.gatewayReference);

    await this.prisma.payment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        gateway: dto.gateway,
        status: PaymentStatus.PENDING,
        amount: chargeAmount,
        currency: chargeCurrency,
        gatewayReference: session.gatewayReference,
      },
    });

    return { invoice, paymentUrl: session.paymentUrl, free: false };
  }

  async verifyAndActivate(opts: {
    tenantId: string;
    gateway: PaymentGateway;
    reference: string;
    invoiceId?: string;
  }) {
    const gw = this.getGateway(opts.gateway);
    const verified = await gw.verifyPayment(opts.reference);

    if (verified.status !== 'success') {
      throw new BadRequestException(`Payment not successful: ${verified.status}`);
    }

    // Find invoice from metadata or provided id
    const invoice = opts.invoiceId
      ? await this.prisma.invoice.findUnique({ where: { id: opts.invoiceId } })
      : await this.prisma.invoice.findFirst({
          where: { tenantId: opts.tenantId, gatewayInvoiceId: opts.reference },
        });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.tenantId !== opts.tenantId) throw new BadRequestException('Invoice does not belong to this tenant');

    // Idempotent: if already paid, return current subscription
    if (invoice.status === 'PAID') {
      return this.subscriptionService.getSubscription(opts.tenantId);
    }

    await this.invoiceService.markPaid(invoice.id, new Date());

    await this.prisma.payment.upsert({
      where: { gatewayPaymentId: verified.gatewayPaymentId },
      update: {
        status: PaymentStatus.SUCCEEDED,
        verifiedAt: new Date(),
        gatewayWebhookData: verified.metadata as object,
      },
      create: {
        tenantId: opts.tenantId,
        invoiceId: invoice.id,
        gateway: opts.gateway,
        status: PaymentStatus.SUCCEEDED,
        amount: verified.amount,
        currency: verified.currency,
        gatewayPaymentId: verified.gatewayPaymentId,
        gatewayReference: verified.gatewayReference,
        verifiedAt: new Date(),
        gatewayWebhookData: verified.metadata as object,
      },
    });

    // Determine plan and cycle from invoice items description
    const planSlug = invoice.metadata
      ? (invoice.metadata as { planSlug?: string })?.planSlug
      : null;

    const plan = planSlug
      ? await this.prisma.plan.findUnique({ where: { slug: planSlug } })
      : null;

    // Fallback: look up by invoice gateway reference metadata
    const resolvedPlan = plan ?? await this.prisma.plan.findUnique({ where: { slug: 'starter' } });
    if (!resolvedPlan) throw new Error('Could not resolve plan for activation');

    const cycle = (invoice.metadata as { cycle?: BillingCycle })?.cycle ?? BillingCycle.MONTHLY;

    return this.subscriptionService.activateFromPayment({
      tenantId: opts.tenantId,
      invoiceId: invoice.id,
      planId: resolvedPlan.id,
      cycle,
      gateway: opts.gateway,
      gatewayCustomerId: verified.gatewayCustomerId,
    });
  }

  async cancelSubscription(tenantId: string, immediately = false) {
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
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      monthlyDiscount: Math.min(monthlyDiscount, plan.monthlyPrice),
      yearlyDiscount: Math.min(yearlyDiscount, plan.yearlyPrice),
    };
  }

  async getUsageHistory(tenantId: string) {
    return this.usageService.getHistoricalUsage(tenantId);
  }
}
