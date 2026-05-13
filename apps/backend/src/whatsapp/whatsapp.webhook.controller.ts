import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { MessageStatus } from '@whatsapp-platform/shared-types';

interface WebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: Array<{
        id: string;
        from: string;
        timestamp: string;
        type: string;
        context?: { id: string; from?: string };
        text?: { body: string };
        image?: { id: string; mime_type: string; sha256: string; caption?: string };
        video?: { id: string; mime_type: string };
        audio?: { id: string; mime_type: string };
        document?: { id: string; mime_type: string; filename?: string };
        sticker?: { id: string; mime_type: string; animated?: boolean };
        reaction?: { message_id: string; emoji: string };
        location?: { latitude: number; longitude: number; name?: string; address?: string };
        contacts?: Array<{ name: { formatted_name: string }; phones?: Array<{ phone: string }> }>;
      }>;
      statuses?: Array<{
        id: string;
        recipient_id: string;
        status: string;
        timestamp: string;
        errors?: Array<{ code: number; title: string }>;
      }>;
    };
    field: string;
  }>;
}

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

@ApiTags('WhatsApp Webhook')
@Controller('webhook/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private prisma: PrismaService,
    private messagesService: MessagesService,
  ) {}

  @Get(':tenantSlug')
  async verify(
    @Param('tenantSlug') tenantSlug: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { webhookVerifyToken: true },
    });

    if (mode === 'subscribe' && tenant && token === tenant.webhookVerifyToken) {
      this.logger.log(`Webhook verified for tenant ${tenantSlug}`);
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  }

  @Post(':tenantSlug')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('tenantSlug') tenantSlug: string,
    @Body() body: { object: string; entry: WebhookEntry[] },
    @Headers('x-hub-signature-256') _signature: string,
  ) {
    if (body.object !== 'whatsapp_business_account') return { status: 'ok' };

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });

    if (!tenant) return { status: 'ok' };

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        if (value.messages?.length) {
          const profileName = value.contacts?.[0]?.profile?.name;
          for (const message of value.messages) {
            try {
              await this.messagesService.handleInbound(tenant.id, message, profileName);
            } catch (error) {
              this.logger.error(`Failed to process inbound message: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }

        if (value.statuses?.length) {
          for (const statusUpdate of value.statuses) {
            const status = STATUS_MAP[statusUpdate.status];
            if (status) {
              try {
                await this.messagesService.updateStatus(statusUpdate.id, status, tenant.id);
              } catch (error) {
                this.logger.warn(`Failed to update message status: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          }
        }
      }
    }

    return { status: 'ok' };
  }
}
