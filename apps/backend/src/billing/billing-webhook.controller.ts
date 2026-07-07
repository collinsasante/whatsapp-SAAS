import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StripeGateway } from './gateways/stripe.gateway';
import { PaystackGateway } from './gateways/paystack.gateway';
import { IBillingGateway, ParsedWebhookEvent } from './gateways/gateway.interface';
import { BillingCycle, PaymentGateway, PaymentStatus, SubscriptionStatus } from '@whatsapp-platform/shared-types';
import { InvoiceService } from './invoice.service';
import { SubscriptionService } from './subscription.service';

@SkipThrottle()
@ApiExcludeController()
@Controller('billing/webhooks')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeGateway,
    private readonly paystack: PaystackGateway,
    private readonly invoiceService: InvoiceService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  async stripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
    return this.handle(PaymentGateway.STRIPE, this.stripe, req, sig);
  }

  @Post('paystack')
  @HttpCode(200)
  async paystackWebhook(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') sig: string) {
    return this.handle(PaymentGateway.PAYSTACK, this.paystack, req, sig);
  }

  private async handle(gateway: PaymentGateway, gw: IBillingGateway, req: RawBodyRequest<Request>, sig: string) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException('Missing raw body');
    if (!gw.verifyWebhookSignature(raw, sig)) {
      throw new BadRequestException(`Invalid ${gateway} signature`);
    }

    let parsed: ParsedWebhookEvent;
    try {
      parsed = await gw.parseWebhookEvent(raw);
    } catch (err) {
      this.logger.error(`Failed to parse ${gateway} webhook: ${String(err)}`);
      return { received: true };
    }

    // Deduplicate — skip already-processed events (webhook retries are common)
    const eventId = parsed.gatewayPaymentId ?? parsed.gatewayReference ?? parsed.gatewaySubscriptionId;
    if (eventId) {
      const existing = await this.prisma.billingEvent.findFirst({
        where: { gatewayEventId: eventId, event: parsed.event, processed: true },
      });
      if (existing) {
        this.logger.log(`Duplicate ${gateway} event skipped: ${parsed.event} / ${eventId}`);
        return { received: true };
      }
    }

    try {
      if (parsed.isCanceled && parsed.gatewaySubscriptionId) {
        await this.handleSubscriptionCanceled(gateway, parsed);
      } else if (parsed.status === 'success' && (parsed.gatewayPaymentId || parsed.gatewayReference)) {
        await this.handlePaymentSuccess(gateway, parsed);
      } else if (parsed.status === 'failed' && (parsed.gatewayPaymentId || parsed.gatewayReference)) {
        await this.handlePaymentFailed(parsed);
      }
    } catch (err) {
      this.logger.error(`Failed to process ${gateway} webhook ${parsed.event}: ${String(err)}`);
    }

    return { received: true };
  }

  private async findPayment(parsed: ParsedWebhookEvent) {
    if (parsed.gatewayPaymentId) {
      const byId = await this.prisma.payment.findUnique({ where: { gatewayPaymentId: parsed.gatewayPaymentId } });
      if (byId) return byId;
    }
    if (parsed.gatewayReference) {
      return this.prisma.payment.findFirst({ where: { gatewayReference: parsed.gatewayReference } });
    }
    return null;
  }

  private async handlePaymentSuccess(gateway: PaymentGateway, parsed: ParsedWebhookEvent) {
    const payment = await this.findPayment(parsed);
    if (!payment) {
      this.logger.warn(`${gateway} payment success for unknown reference: ${parsed.gatewayReference}`);
      return;
    }

    const eventId = parsed.gatewayPaymentId ?? parsed.gatewayReference!;
    await this.prisma.billingEvent.create({
      data: {
        tenantId: payment.tenantId,
        event: parsed.event,
        gateway,
        gatewayEventId: eventId,
        data: parsed as unknown as object,
        processed: false,
      },
    });

    if (payment.status !== PaymentStatus.SUCCEEDED) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          gatewayPaymentId: parsed.gatewayPaymentId ?? payment.gatewayPaymentId,
          verifiedAt: new Date(),
          gatewayWebhookData: parsed as unknown as object,
        },
      });
    }

    // Credit purchase (no invoice attached)
    if (!payment.invoiceId) {
      const purchase = await this.prisma.creditPurchase.findFirst({ where: { paystackRef: payment.gatewayReference ?? undefined } });
      if (purchase && purchase.status !== PaymentStatus.SUCCEEDED) {
        await Promise.all([
          this.prisma.creditPurchase.update({ where: { id: purchase.id }, data: { status: PaymentStatus.SUCCEEDED } }),
          this.prisma.tenant.update({ where: { id: purchase.tenantId }, data: { aiCredits: { increment: purchase.credits } } }),
        ]);
        this.logger.log(`${purchase.credits} AI credits added to tenant ${purchase.tenantId} via ${gateway}`);
      }
    } else {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: payment.invoiceId } });
      if (invoice && invoice.status !== 'PAID') {
        await this.invoiceService.markPaid(invoice.id);

        const meta = invoice.metadata as { planId?: string; planSlug?: string; cycle?: BillingCycle } | null;
        const plan = meta?.planId
          ? await this.prisma.plan.findUnique({ where: { id: meta.planId } })
          : meta?.planSlug
            ? await this.prisma.plan.findUnique({ where: { slug: meta.planSlug } })
            : null;

        if (plan) {
          const paymentMeta = payment.metadata as { stripeSubscriptionId?: string } | null;
          await this.subscriptionService.activateFromPayment({
            tenantId: payment.tenantId,
            invoiceId: invoice.id,
            planId: plan.id,
            cycle: meta?.cycle ?? BillingCycle.MONTHLY,
            gateway,
            gatewayCustomerId: parsed.metadata?.gatewayCustomerId as string | undefined,
          });

          if (gateway === PaymentGateway.STRIPE && paymentMeta?.stripeSubscriptionId) {
            await this.prisma.subscription.update({
              where: { tenantId: payment.tenantId },
              data: { stripeSubscriptionId: paymentMeta.stripeSubscriptionId },
            });
          }
          if (gateway === PaymentGateway.PAYSTACK && parsed.gatewaySubscriptionId) {
            await this.prisma.subscription.update({
              where: { tenantId: payment.tenantId },
              data: { paystackSubscriptionCode: parsed.gatewaySubscriptionId },
            });
          }
        }
        this.logger.log(`Subscription activated for tenant ${payment.tenantId} via ${gateway}`);
      } else if (invoice && parsed.isRenewal && parsed.periodEnd) {
        // Recurring renewal charge — extend the current period, no re-activation needed
        await this.prisma.subscription.updateMany({
          where: { tenantId: payment.tenantId },
          data: { currentPeriodEnd: parsed.periodEnd, status: SubscriptionStatus.ACTIVE },
        });
        this.logger.log(`Subscription renewed for tenant ${payment.tenantId} via ${gateway}, period end ${parsed.periodEnd.toISOString()}`);
      }
    }

    await this.prisma.billingEvent.updateMany({ where: { gatewayEventId: eventId, event: parsed.event }, data: { processed: true } });
  }

  private async handlePaymentFailed(parsed: ParsedWebhookEvent) {
    const payment = await this.findPayment(parsed);
    if (!payment) return;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED, failReason: 'Payment failed' },
    });
  }

  private async handleSubscriptionCanceled(gateway: PaymentGateway, parsed: ParsedWebhookEvent) {
    const where = gateway === PaymentGateway.STRIPE
      ? { stripeSubscriptionId: parsed.gatewaySubscriptionId }
      : { paystackSubscriptionCode: parsed.gatewaySubscriptionId };

    const sub = await this.prisma.subscription.findFirst({ where });
    if (!sub) return;

    await this.prisma.subscription.update({
      where: { tenantId: sub.tenantId },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
    });

    await this.prisma.billingEvent.create({
      data: {
        tenantId: sub.tenantId,
        event: parsed.event,
        gateway,
        gatewayEventId: parsed.gatewaySubscriptionId,
        data: parsed as unknown as object,
        processed: true,
      },
    });

    this.logger.log(`Subscription canceled for tenant ${sub.tenantId} via ${gateway}`);
  }
}
