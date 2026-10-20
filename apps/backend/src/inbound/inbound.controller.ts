import { BadRequestException, Body, Controller, Headers, HttpCode, Logger, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { InboundService } from './inbound.service';

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
    } else if (!this.warnedUnconfiguredSecret) {
      // Accepting unsigned mail is how this endpoint has always behaved; rejecting it on deploy would silently stop
      // inbound email on a server that has not been given the secret yet. Set RESEND_WEBHOOK_SECRET to enforce it.
      this.warnedUnconfiguredSecret = true;
      this.logger.warn('RESEND_WEBHOOK_SECRET is not configured: inbound email webhook signatures are NOT being verified.');
    }

    await this.inboundService.handleInboundEmail(body);
    return { ok: true };
  }
}
