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

    return { invoice, paymentUrl: session.paymentUrl, reference: session.gatewayReference, free: false };
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

  // Credit pack definitions (USD pricing)
  static readonly CREDIT_PACKS = [
    { slug: 'starter-200',  credits: 200,  amount: 5,   label: '200 Credits',  description: 'Great for small teams getting started' },
    { slug: 'growth-600',   credits: 600,  amount: 12,  label: '600 Credits',  description: 'Most popular — 3× more value' },
    { slug: 'pro-1500',     credits: 1500, amount: 25,  label: '1,500 Credits', description: 'Best value for active workspaces' },
    { slug: 'scale-4000',   credits: 4000, amount: 55,  label: '4,000 Credits', description: 'High-volume teams' },
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

  async initiateCreditPurchase(tenantId: string, packSlug: string, billingEmail: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, billingEmail: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const pack = BillingService.CREDIT_PACKS.find((p) => p.slug === packSlug);
    if (!pack) throw new BadRequestException('Invalid credit pack');

    const email = billingEmail || tenant.billingEmail || '';
    if (!email) throw new BadRequestException('Billing email is required');

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');

    // Initialize Paystack transaction
    const res = await (await import('axios')).default.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: Math.round(pack.amount * 100),
        currency: 'USD',
        callback_url: `${frontendUrl}/billing?credits=success&pack=${packSlug}`,
        metadata: { tenantId, packSlug, credits: pack.credits, type: 'credit_purchase' },
      },
      { headers: { Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY', '')}` } },
    ).catch((err) => {
      throw new BadRequestException(`Paystack error: ${String(err?.response?.data?.message ?? err.message)}`);
    });

    const { reference, access_code } = res.data.data as { reference: string; access_code: string };

    // Create pending credit purchase record
    await this.prisma.creditPurchase.create({
      data: {
        tenantId,
        credits: pack.credits,
        packSlug,
        amount: pack.amount,
        currency: 'USD',
        paystackRef: reference,
        status: 'PENDING',
      },
    });

    return { reference, accessCode: access_code, amount: pack.amount, credits: pack.credits, pack };
  }

  async verifyCreditPurchase(tenantId: string, reference: string) {
    const purchase = await this.prisma.creditPurchase.findUnique({
      where: { paystackRef: reference },
    });
    if (!purchase) throw new NotFoundException('Credit purchase not found');
    if (purchase.tenantId !== tenantId) throw new BadRequestException('Purchase does not belong to this tenant');
    if (purchase.status === 'SUCCEEDED') {
      return { success: true, credits: purchase.credits, alreadyProcessed: true };
    }

    // Verify with Paystack
    const verified = await this.paystackGateway.verifyPayment(reference);
    if (verified.status !== 'success') {
      await this.prisma.creditPurchase.update({
        where: { id: purchase.id },
        data: { status: 'FAILED' },
      });
      throw new BadRequestException('Payment not successful');
    }

    // Mark success and add credits atomically
    await Promise.all([
      this.prisma.creditPurchase.update({
        where: { id: purchase.id },
        data: { status: 'SUCCEEDED' },
      }),
      this.prisma.tenant.update({
        where: { id: tenantId },
        data: { aiCredits: { increment: purchase.credits } },
      }),
    ]);

    const updated = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiCredits: true },
    });

    return { success: true, credits: purchase.credits, newBalance: updated?.aiCredits ?? 0 };
  }
}
