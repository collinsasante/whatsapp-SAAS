import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BillingCycle, PaymentGateway } from '@whatsapp-platform/shared-types';
import { SubscriptionService } from './subscription.service';
import { InvoiceService } from './invoice.service';
import { UsageService } from './usage.service';
import { EmailService } from '../common/email.service';
import { InitiateCheckoutDto } from './dto/billing.dto';
import { randomBytes } from 'crypto';

function genRef(prefix: string) {
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export const PAYMENT_DETAILS = {
  mobileMoney: [
    { network: 'MTN Mobile Money', number: '055 000 0000', name: 'VerzChat Ltd' },
  ],
  bank: {
    bankName: 'GCB Bank Ghana',
    accountNumber: '1234567890',
    accountName: 'VerzChat Ltd',
    branch: 'Accra Central',
  },
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly subscriptionService: SubscriptionService,
    private readonly invoiceService: InvoiceService,
    private readonly usageService: UsageService,
    private readonly emailService: EmailService,
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

  async initiateCheckout(tenantId: string, dto: InitiateCheckoutDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, billingEmail: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const plan = await this.prisma.plan.findUnique({ where: { slug: dto.planSlug } });
    if (!plan) throw new NotFoundException(`Plan not found: ${dto.planSlug}`);

    if (plan.monthlyPrice === 0) {
      // Free plan — activate immediately
      const sub = await this.subscriptionService.getOrCreateFreeTrial(tenantId);
      return { free: true, subscription: sub, paymentDetails: null, reference: null };
    }

    const baseAmount = dto.cycle === BillingCycle.YEARLY ? plan.yearlyPrice : plan.monthlyPrice;

    const now = new Date();
    const periodEnd = dto.cycle === BillingCycle.YEARLY
      ? new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const reference = genRef('VRZ');

    const invoice = await this.invoiceService.createInvoice({
      tenantId,
      planName: plan.name,
      planSlug: dto.planSlug,
      amount: baseAmount,
      currency: plan.currency ?? 'USD',
      billingEmail: dto.billingEmail ?? tenant.billingEmail ?? '',
      billingName: tenant.name,
      periodStart: now,
      periodEnd,
    });

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        gatewayInvoiceId: reference,
        metadata: { planSlug: dto.planSlug, planId: plan.id, cycle: dto.cycle },
      },
    });

    const adminSecret = this.config.get<string>('PLATFORM_ADMIN_SETUP_SECRET', '');
    const apiUrl = this.config.get<string>('API_URL', 'https://verzchat.com/api/v1');
    const activateUrl = `${apiUrl}/billing/admin/activate?ref=${reference}&secret=${encodeURIComponent(adminSecret)}`;

    const currencySymbol = '$';

    const notifyEmail = this.config.get<string>('SUPPORT_FORWARD_EMAIL', 'support@verzchat.com');

    await this.emailService.sendRaw({
      to: notifyEmail,
      subject: `[payment] ${tenant.name} — ${plan.name} Plan (${dto.cycle}) — ${currencySymbol}${baseAmount}`,
      html: `
        <h2 style="margin:0 0 16px">New Plan Payment Pending</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#666">Workspace</td><td style="font-weight:600">${tenant.name}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Plan</td><td style="font-weight:600">${plan.name} (${dto.cycle})</td></tr>
          <tr><td style="padding:6px 0;color:#666">Amount</td><td style="font-weight:600">$${baseAmount} USD</td></tr>
          <tr><td style="padding:6px 0;color:#666">Reference</td><td style="font-weight:600;font-family:monospace">${reference}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Invoice</td><td>${invoice.invoiceNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Billing Email</td><td>${dto.billingEmail ?? tenant.billingEmail ?? '—'}</td></tr>
        </table>
        <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb" />
        <p style="font-size:13px;color:#374151">Once you have verified the payment, click the button below to activate their subscription:</p>
        <a href="${activateUrl}" style="display:inline-block;margin-top:8px;padding:12px 24px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
          Activate Subscription
        </a>
        <p style="font-size:11px;color:#9ca3af;margin-top:12px">Or copy this link: ${activateUrl}</p>
      `,
    }).catch((err: unknown) => {
      this.logger.error('Failed to send payment notification email', (err as Error).message);
    });

    return { free: false, reference, paymentDetails: PAYMENT_DETAILS, amount: baseAmount, currency: 'USD', plan };
  }

  async adminActivateSubscription(secret: string, reference: string) {
    const adminSecret = this.config.get<string>('PLATFORM_ADMIN_SETUP_SECRET', '');
    if (!adminSecret || secret !== adminSecret) throw new UnauthorizedException('Invalid admin secret');

    const invoice = await this.prisma.invoice.findFirst({
      where: { gatewayInvoiceId: reference },
    });
    if (!invoice) throw new NotFoundException(`Invoice not found for reference ${reference}`);
    if (invoice.status === 'PAID') {
      return { alreadyActivated: true, message: 'Subscription already activated' };
    }

    await this.invoiceService.markPaid(invoice.id, new Date());

    const meta = invoice.metadata as { planId?: string; planSlug?: string; cycle?: BillingCycle } | null;
    const plan = meta?.planId
      ? await this.prisma.plan.findUnique({ where: { id: meta.planId } })
      : meta?.planSlug
        ? await this.prisma.plan.findUnique({ where: { slug: meta.planSlug } })
        : null;

    if (!plan) throw new NotFoundException('Could not resolve plan from invoice');

    const sub = await this.subscriptionService.activateFromPayment({
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
      planId: plan.id,
      cycle: meta?.cycle ?? BillingCycle.MONTHLY,
      gateway: PaymentGateway.PAYSTACK,
    });

    this.logger.log(`Admin activated subscription for tenant ${invoice.tenantId} via reference ${reference}`);
    return { activated: true, subscription: sub };
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

  async initiateCreditPurchase(tenantId: string, packSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, billingEmail: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const pack = BillingService.CREDIT_PACKS.find((p) => p.slug === packSlug);
    if (!pack) throw new BadRequestException('Invalid credit pack');

    const reference = genRef('VRZ-C');

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

    const adminSecret = this.config.get<string>('PLATFORM_ADMIN_SETUP_SECRET', '');
    const apiUrl = this.config.get<string>('API_URL', 'https://verzchat.com/api/v1');
    const activateUrl = `${apiUrl}/billing/admin/activate-credits?ref=${reference}&secret=${encodeURIComponent(adminSecret)}`;

    const notifyEmail = this.config.get<string>('SUPPORT_FORWARD_EMAIL', 'support@verzchat.com');

    await this.emailService.sendRaw({
      to: notifyEmail,
      subject: `[credits] ${tenant.name} — ${pack.label} — $${pack.amount} USD`,
      html: `
        <h2 style="margin:0 0 16px">New AI Credits Payment Pending</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#666">Workspace</td><td style="font-weight:600">${tenant.name}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Pack</td><td style="font-weight:600">${pack.label}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Amount</td><td style="font-weight:600">$${pack.amount} USD</td></tr>
          <tr><td style="padding:6px 0;color:#666">Reference</td><td style="font-weight:600;font-family:monospace">${reference}</td></tr>
        </table>
        <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb" />
        <p style="font-size:13px;color:#374151">Once you have verified the payment, click the button below to add the credits:</p>
        <a href="${activateUrl}" style="display:inline-block;margin-top:8px;padding:12px 24px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
          Add Credits
        </a>
        <p style="font-size:11px;color:#9ca3af;margin-top:12px">Or copy this link: ${activateUrl}</p>
      `,
    }).catch((err: unknown) => {
      this.logger.error('Failed to send credits notification email', (err as Error).message);
    });

    return { reference, amount: pack.amount, credits: pack.credits, pack, paymentDetails: PAYMENT_DETAILS };
  }

  async adminActivateCredits(secret: string, reference: string) {
    const adminSecret = this.config.get<string>('PLATFORM_ADMIN_SETUP_SECRET', '');
    if (!adminSecret || secret !== adminSecret) throw new UnauthorizedException('Invalid admin secret');

    const purchase = await this.prisma.creditPurchase.findUnique({ where: { paystackRef: reference } });
    if (!purchase) throw new NotFoundException(`Credit purchase not found for reference ${reference}`);

    if (purchase.status === 'SUCCEEDED') {
      return { alreadyActivated: true, message: 'Credits already added' };
    }

    await Promise.all([
      this.prisma.creditPurchase.update({ where: { id: purchase.id }, data: { status: 'SUCCEEDED' } }),
      this.prisma.tenant.update({ where: { id: purchase.tenantId }, data: { aiCredits: { increment: purchase.credits } } }),
    ]);

    const updated = await this.prisma.tenant.findUnique({ where: { id: purchase.tenantId }, select: { aiCredits: true } });
    this.logger.log(`Admin added ${purchase.credits} credits to tenant ${purchase.tenantId} via reference ${reference}`);

    return { activated: true, creditsAdded: purchase.credits, newBalance: updated?.aiCredits ?? 0 };
  }
}
