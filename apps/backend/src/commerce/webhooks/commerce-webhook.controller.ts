import { BadRequestException, Controller, Headers, HttpCode, Logger, Post, RawBodyRequest, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhookSource } from '@prisma/client';
import { PaystackGateway } from '../../billing/gateways/paystack.gateway';
import { CommerceLedgerService } from '../ledger/commerce-ledger.service';
import { WebhookEventService } from '../../common/monitoring/webhook-event.service';

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
    private readonly paystack: PaystackGateway,
    private readonly ledgerService: CommerceLedgerService,
    private readonly webhookEventService: WebhookEventService,
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

    const eventLogId = await this.webhookEventService.recordReceived({
      source: WebhookSource.PAYSTACK_COMMERCE,
      eventType: parsed.event,
      gatewayEventId: parsed.gatewayPaymentId ?? parsed.gatewayReference,
      // parsed is stored (not raw) -- already signature-verified and structurally
      // safe to replay later via CommerceLedgerService.reprocessWebhookEvent()
      // without needing the original signature.
      payload: parsed,
    });

    try {
      await this.ledgerService.processPaystackWebhookPayload(parsed);
      await this.webhookEventService.markOutcome(eventLogId, 'PROCESSED');
    } catch (err) {
      await this.webhookEventService.markOutcome(eventLogId, 'FAILED', err instanceof Error ? err.message : String(err));
      throw err;
    }

    return { received: true };
  }
}
