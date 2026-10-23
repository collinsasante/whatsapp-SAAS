import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Headers,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
  BadRequestException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { WebhookEventService } from '../common/monitoring/webhook-event.service';
import { WebhookSource, ChannelType } from '@prisma/client';
import { MessageStatus } from '@whatsapp-platform/shared-types';
import { notify } from '../common/notifier';
import { verifyWhatsAppSignature } from '../whatsapp/webhook-signature.util';

export interface MessengerAttachment {
  type: string; // 'image' | 'video' | 'audio' | 'file'
  payload: { url?: string };
}

export interface MessengerMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: MessengerAttachment[];
    is_echo?: boolean; // messages the Page itself sent, echoed back -- must not be treated as inbound
  };
  delivery?: { mids?: string[]; watermark?: number };
  // Messenger sends a time watermark; Instagram ("messaging_seen") sends the id of the last message seen.
  read?: { watermark?: number; mid?: string };
  postback?: { title: string; payload: string };
}

export interface MessengerWebhookEntry {
  id: string; // the Page ID
  time: number;
  messaging: MessengerMessagingEvent[];
}

interface MessengerWebhookBody {
  object: string; // 'page' (Messenger) or 'instagram'
  entry: MessengerWebhookEntry[];
}

type Platform = 'MESSENGER' | 'INSTAGRAM';

/**
 * Real Meta Messenger Platform webhook. Instagram messaging is delivered by the same Meta app webhook with
 * object 'instagram' (entry.id is then the Instagram account id), so one URL and verify token serve both: point the
 * Instagram webhook subscription at this same callback.
 * Unlike WhatsApp's per-tenant URL
 * (webhook/whatsapp/:tenantId, matching WhatsApp's per-WABA subscription
 * model), Messenger's webhook subscription is app-level -- Meta calls this
 * one URL for every Page across every tenant, and routing happens purely by
 * matching each entry's Page ID (entry.id) against Channel.externalId.
 */
@SkipThrottle()
@ApiTags('Facebook Messenger Webhook')
@Controller('webhook/messenger')
export class MessengerWebhookController {
  private readonly logger = new Logger(MessengerWebhookController.name);

  constructor(
    private prisma: PrismaService,
    private messagesService: MessagesService,
    private webhookEventService: WebhookEventService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken = process.env['MESSENGER_WEBHOOK_VERIFY_TOKEN'];
    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
      this.logger.log('Messenger webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // Same primitive as WhatsApp's assertValidSignature (verifyWhatsAppSignature
  // is provider-agnostic despite the name -- both products are signed with
  // the same Meta App Secret mechanism). Fails open with no secret configured
  // in non-production so this can ship ahead of the secret being provisioned
  // there; fails CLOSED in production -- see whatsapp.webhook.controller.ts's
  // assertValidSignature for the same reasoning.
  private assertValidSignature(raw: Buffer | undefined, signature: string | undefined): void {
    const appSecret = process.env['FACEBOOK_APP_SECRET'];
    if (!appSecret) {
      if (process.env['NODE_ENV'] === 'production') {
        throw new BadRequestException('Webhook signature verification is not configured');
      }
      this.logger.warn('FACEBOOK_APP_SECRET not configured -- Messenger webhook signature verification is disabled');
      return;
    }
    if (!verifyWhatsAppSignature(raw, signature, appSecret)) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: MessengerWebhookBody,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    this.assertValidSignature(req.rawBody, signature);
    if (body.object !== 'page' && body.object !== 'instagram') return { status: 'ok' };
    const platform: Platform = body.object === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';

    const pageIds = new Set<string>();
    for (const entry of body.entry ?? []) {
      if (entry.id) pageIds.add(entry.id);
    }
    if (pageIds.size === 0) return { status: 'ok' };

    // Fan-out purely by Page ID -- never by sender phone/name/session. A
    // Page ID could in principle be connected to more than one tenant (the
    // Channel.externalId unique constraint is scoped per-tenant, not
    // globally), so every matching active Channel gets processed, mirroring
    // WhatsApp's own same-number-multiple-tenants fan-out tolerance.
    const channels = await this.prisma.channel.findMany({
      where: { type: platform === 'INSTAGRAM' ? ChannelType.INSTAGRAM : ChannelType.FACEBOOK_MESSENGER, externalId: { in: [...pageIds] }, isActive: true, tenant: { isActive: true } },
      select: { id: true, tenantId: true, externalId: true },
    });

    if (channels.length === 0) {
      this.logger.debug(`${platform === 'INSTAGRAM' ? 'Instagram' : 'Messenger'} webhook for unknown/inactive account ID(s) [${[...pageIds].join(', ')}]`);
      return { status: 'ok' };
    }

    for (const channel of channels) {
      const entry = (body.entry ?? []).find((e) => e.id === channel.externalId);
      if (!entry) continue;

      const eventId = await this.webhookEventService.recordReceived({
        source: WebhookSource.MESSENGER,
        eventType: platform === 'INSTAGRAM' ? 'instagram_messaging' : 'messaging',
        tenantId: channel.tenantId,
        payload: entry,
      });
      try {
        await this.processEntryForChannel(channel.tenantId, channel.id, entry, platform);
        await this.webhookEventService.markOutcome(eventId, 'PROCESSED');
      } catch (error) {
        await this.webhookEventService.markOutcome(eventId, 'FAILED', error instanceof Error ? error.message : String(error));
        throw error;
      }
    }

    return { status: 'ok' };
  }

  private async processEntryForChannel(tenantId: string, channelId: string, entry: MessengerWebhookEntry, platform: Platform) {
    for (const event of entry.messaging ?? []) {
      if (event.message && !event.message.is_echo) {
        try {
          await this.messagesService.handleInboundMessenger(tenantId, channelId, event.sender.id, event.message, platform);
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`[tenant:${tenantId}] Failed to process inbound ${platform === 'INSTAGRAM' ? 'Instagram' : 'Messenger'} message ${event.message.mid}: ${errMessage}`);
          void notify({
            source: 'backend',
            tenantId,
            message: `Failed to process inbound ${platform === 'INSTAGRAM' ? 'Instagram' : 'Messenger'} message: ${errMessage}`,
            stack: error instanceof Error ? error.stack : undefined,
          }).catch(() => {});
        }
      }
      // Delivered and read receipts become the same message ticks WhatsApp has. A failure here must never fail the
      // webhook (Meta would retry the whole entry), so it is logged and the rest of the entry still runs.
      for (const [status, receipt] of [[MessageStatus.DELIVERED, event.delivery], [MessageStatus.READ, event.read]] as const) {
        if (!receipt) continue;
        try {
          await this.messagesService.handleMetaReceipt(tenantId, channelId, event.sender.id, platform, status, receipt);
        } catch (error) {
          this.logger.warn(`[tenant:${tenantId}] Failed to apply a ${status} receipt from ${platform === 'INSTAGRAM' ? 'Instagram' : 'Messenger'}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // Postbacks stay logging-only via the WebhookEventService record above.
    }
  }
}
