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
import { FlutterwaveGateway } from './gateways/flutterwave.gateway';
import { BillingService } from './billing.service';
import { BillingCycle, PaymentGateway, PaymentStatus } from '@whatsapp-platform/shared-types';
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
    private readonly flutterwave: FlutterwaveGateway,
    private readonly billingService: BillingService,
    private readonly invoiceService: InvoiceService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException('Missing raw body');
    if (!this.stripe.verifyWebhookSignature(raw, sig)) {
      throw new BadRequestException('Invalid Stripe signature');
    }
    return this.handleWebhookEvent(PaymentGateway.STRIPE, raw, sig);
  }

  @Post('paystack')
  @HttpCode(200)
  async paystackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') sig: string,
  ) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException('Missing raw body');
    if (!this.paystack.verifyWebhookSignature(raw, sig)) {
      throw new BadRequestException('Invalid Paystack signature');
    }
    return this.handleWebhookEvent(PaymentGateway.PAYSTACK, raw, sig);
  }

  @Post('flutterwave')
  @HttpCode(200)
  async flutterwaveWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('verif-hash') sig: string,
  ) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException('Missing raw body');
    if (!this.flutterwave.verifyWebhookSignature(raw, sig)) {
      throw new BadRequestException('Invalid Flutterwave signature');
    }
    return this.handleWebhookEvent(PaymentGateway.FLUTTERWAVE, raw, sig);
  }

  private async handleWebhookEvent(gateway: PaymentGateway, raw: Buffer, _sig: string) {
    const gw = gateway === PaymentGateway.STRIPE ? this.stripe
      : gateway === PaymentGateway.PAYSTACK ? this.paystack
      : this.flutterwave;

    let parsed: Awaited<ReturnType<typeof gw.parseWebhookEvent>>;
    try {
      parsed = await gw.parseWebhookEvent(raw);
    } catch (err) {
      this.logger.error(`Failed to parse ${gateway} webhook: ${String(err)}`);
      return { received: true };
    }

    // Deduplicate — skip already-processed events
    if (parsed.gatewayPaymentId) {
      const existing = await this.prisma.billingEvent.findFirst({
        where: { gatewayEventId: parsed.gatewayPaymentId, processed: true },
      });
      if (existing) {
        this.logger.log(`Duplicate ${gateway} event skipped: ${parsed.gatewayPaymentId}`);
        return { received: true };
      }
    }

    // Find the payment record to resolve tenantId
    const payment = parsed.gatewayPaymentId
      ? await this.prisma.payment.findUnique({ where: { gatewayPaymentId: parsed.gatewayPaymentId } })
      : parsed.gatewayReference
        ? await this.prisma.payment.findFirst({ where: { gatewayReference: parsed.gatewayReference } })
        : null;

    const tenantId = payment?.tenantId;

    if (tenantId) {
      await this.prisma.billingEvent.create({
        data: {
          tenantId,
          event: parsed.event,
          gateway,
          gatewayEventId: parsed.gatewayPaymentId ?? parsed.gatewayReference,
          data: parsed as object,
          processed: false,
        },
      });
    }

    const isPaymentSuccess =
      parsed.event.includes('payment_intent.succeeded') ||
      parsed.event === 'checkout.session.completed' ||
      parsed.event === 'charge.succeeded' ||
      parsed.event === 'transaction.success' ||
      parsed.event === 'charge.completed';

    if (isPaymentSuccess && tenantId && payment) {
      try {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            gatewayPaymentId: parsed.gatewayPaymentId ?? payment.gatewayPaymentId,
            verifiedAt: new Date(),
            gatewayWebhookData: parsed as object,
          },
        });

        if (payment.invoiceId) {
          const invoice = await this.prisma.invoice.findUnique({
            where: { id: payment.invoiceId },
          });
          if (invoice && invoice.status !== 'PAID') {
            await this.invoiceService.markPaid(invoice.id);

            const meta = invoice.metadata as { planId?: string; planSlug?: string; cycle?: BillingCycle } | null;
            const planId = meta?.planId;
            const planSlug = meta?.planSlug;

            const plan = planId
              ? await this.prisma.plan.findUnique({ where: { id: planId } })
              : planSlug
                ? await this.prisma.plan.findUnique({ where: { slug: planSlug } })
                : null;

            if (plan) {
              await this.subscriptionService.activateFromPayment({
                tenantId,
                invoiceId: invoice.id,
                planId: plan.id,
                cycle: meta?.cycle ?? BillingCycle.MONTHLY,
                gateway,
              });
            }
          }
        }

        await this.prisma.billingEvent.updateMany({
          where: { tenantId, gatewayEventId: parsed.gatewayPaymentId ?? parsed.gatewayReference },
          data: { processed: true },
        });

        this.logger.log(`Webhook payment activated for tenant ${tenantId}`);
      } catch (err) {
        this.logger.error(`Failed to activate payment for tenant ${tenantId}: ${String(err)}`);
        if (tenantId) {
          await this.prisma.billingEvent.updateMany({
            where: { tenantId, gatewayEventId: parsed.gatewayPaymentId ?? parsed.gatewayReference },
            data: { error: String(err) },
          });
        }
      }
    }

    const isPaymentFailed =
      parsed.event.includes('payment_intent.payment_failed') ||
      parsed.event === 'charge.failed' ||
      parsed.event === 'transaction.failed';

    if (isPaymentFailed && payment) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failReason: String(parsed.metadata ?? 'Payment failed') },
      });
    }

    return { received: true };
  }
}
