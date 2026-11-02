import { BadRequestException, Body, Controller, Headers, HttpCode, Logger, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { InboundService } from './inbound.service';

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

@ApiTags('Inbound')
@Controller('inbound')
export class InboundController {
  private readonly logger = new Logger(InboundController.name);
  private warnedUnconfiguredSecret = false;

  constructor(
    private readonly inboundService: InboundService,
    private readonly config: ConfigService,
  ) {}

  private verifyResendSignature(
    secret: string,
    msgId: string,
    timestamp: string,
    rawBody: Buffer,
    signatures: string,
  ): void {
    // Replay protection: Svix signs the timestamp, so a captured request is only valid for a few minutes.
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
      throw new BadRequestException('Webhook timestamp outside the allowed window');
    }
    // Svix signature format: whsec_<base64secret>
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const toSign = Buffer.from(`${msgId}.${timestamp}.${rawBody.toString()}`);
    const computed = createHmac('sha256', key).update(toSign).digest('base64');
    const computedBuf = Buffer.from(`v1,${computed}`);

    const valid = signatures.split(' ').some((sig) => {
      try {
        const sigBuf = Buffer.from(sig);
        return sigBuf.length === computedBuf.length && timingSafeEqual(sigBuf, computedBuf);
      } catch {
        return false;
      }
    });

    if (!valid) throw new BadRequestException('Invalid webhook signature');
  }

  @Post('email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend inbound email webhook' })
  async receiveEmail(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
  ) {
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    if (secret) {
      if (!svixId || !svixTimestamp || !svixSignature) {
        throw new BadRequestException('Missing webhook signature headers');
      }
      this.verifyResendSignature(secret, svixId, svixTimestamp, req.rawBody as Buffer, svixSignature);
    } else {
      // Unsigned mail is refused in production: this endpoint feeds support tickets and notifications, so anyone able to POST
      // here could otherwise inject them. Elsewhere it is accepted with a once-per-start warning.
      const production = this.config.get<string>('NODE_ENV') === 'production';
      if (!this.warnedUnconfiguredSecret) {
        this.warnedUnconfiguredSecret = true;
        if (production) this.logger.error('RESEND_WEBHOOK_SECRET is not configured: inbound email webhooks are being REFUSED.');
        else this.logger.warn('RESEND_WEBHOOK_SECRET is not configured: inbound email webhook signatures are NOT being verified (non-production).');
      }
      if (production) throw new BadRequestException('Webhook signature verification is not configured');
    }

    await this.inboundService.handleInboundEmail(body);
    return { ok: true };
  }
}
