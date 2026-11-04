import { Body, Controller, HttpCode, Headers, Logger, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { TelegramService } from './telegram.service';

/**
 * Telegram Bot API webhook. Public by necessity; authenticated by the per-channel secret token Telegram echoes in `X-Telegram-Bot-Api-Secret-Token`
 * (set when the webhook was registered). A wrong or missing secret is a 403 with no detail; an unknown channel is a 404. A processing failure returns
 * 500 so Telegram retries the delivery (messages are de-duplicated by their Telegram id, so a retry is safe).
 */
@ApiTags('Webhooks')
@SkipThrottle()
@Controller('webhook/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);
  constructor(private readonly telegram: TelegramService) {}

  @Post(':channelId')
  @Public()
  @HttpCode(200)
  async receive(@Param('channelId') channelId: string, @Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: unknown) {
    const r = await this.telegram.handleUpdate(channelId, secret, update);
    return { ok: true, status: r.status };
  }
}
