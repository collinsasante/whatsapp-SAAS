import { BadRequestException, Controller, Headers, HttpCode, Logger, Post, RawBodyRequest, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PaystackGateway } from '../../billing/gateways/paystack.gateway';
import { CommerceLedgerService } from '../ledger/commerce-ledger.service';

/**
 * Commerce payment webhooks -- structurally separate from BillingWebhookController
 * (apps/backend/src/billing/) even though both use PaystackGateway, because this
 * controller resolves an Order (not a Subscription/Invoice) and its only downstream
 * effect is CommerceLedgerService.recordPaymentSuccess. Keeping them apart means a
 * bug in one webhook path can never accidentally touch the other domain's data.
 */
@SkipThrottle()
@ApiExcludeController()
@Controller('commerce/webhooks')
export class CommerceWebhookController {
  private readonly logger = new Logger(CommerceWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackGateway,
    private readonly ledgerService: CommerceLedgerService,
  ) {}

  @Post('paystack')
  @HttpCode(200)
  async paystackWebhook(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') sig: string) {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException('Missing raw body');
    if (!this.paystack.verifyWebhookSignature(raw, sig)) {
      throw new BadRequestException('Invalid Paystack signature');
    }

    const parsed = await this.paystack.parseWebhookEvent(raw).catch((err) => {
      this.logger.error(`Failed to parse commerce Paystack webhook: ${String(err)}`);
      return null;
    });
    if (!parsed) return { received: true };

    if (parsed.status !== 'success' || !parsed.gatewayReference) {
      return { received: true };
    }

    const orderId = (parsed.metadata as Record<string, unknown> | undefined)?.['orderId'] as string | undefined;
    const order = orderId
      ? await this.prisma.order.findUnique({ where: { id: orderId } })
      : await this.prisma.order.findFirst({ where: { paystackReference: parsed.gatewayReference } });

    if (!order) {
      this.logger.warn(`Commerce Paystack webhook for unknown order (reference ${parsed.gatewayReference})`);
      return { received: true };
    }

    const eventId = parsed.gatewayPaymentId ?? parsed.gatewayReference;
    await this.ledgerService.recordPaymentSuccess(order.id, eventId, parsed.amount ?? order.totalMajorUnits);

    return { received: true };
  }
}
