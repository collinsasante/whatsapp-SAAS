import { BadRequestException, Body, Controller, Headers, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Webhook } from 'svix';
import { InboundService } from './inbound.service';

@ApiTags('Inbound')
@Controller('inbound')
export class InboundController {
  constructor(
    private readonly inboundService: InboundService,
    private readonly config: ConfigService,
  ) {}

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
      try {
        const wh = new Webhook(secret);
        wh.verify(req.rawBody as Buffer, {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        });
      } catch {
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    await this.inboundService.handleInboundEmail(body);
    return { ok: true };
  }
}
