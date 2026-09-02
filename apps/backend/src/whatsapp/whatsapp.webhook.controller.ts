import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  Inject,
  forwardRef,
  RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { CallsService } from '../calls/calls.service';
import { MessageStatus } from '@whatsapp-platform/shared-types';
import { notify } from '../common/notifier';
import { verifyWhatsAppSignature } from './webhook-signature.util';

interface CallEvent {
  id: string;
  from?: string;
  event: string;
  status?: string;
  timestamp?: string;
  direction?: string;
  duration?: number;
  start_time?: string;
  end_time?: string;
  session?: { sdp_type: string; sdp: string };
}

interface WebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      calls?: CallEvent[];
      messages?: Array<{
        id: string;
        from: string;
        timestamp: string;
        type: string;
        context?: { id: string; from?: string; forwarded?: boolean };
        text?: { body: string };
        image?: { id: string; mime_type: string; sha256: string; caption?: string };
        video?: { id: string; mime_type: string };
        audio?: { id: string; mime_type: string };
        document?: { id: string; mime_type: string; filename?: string };
        sticker?: { id: string; mime_type: string; animated?: boolean };
        reaction?: { message_id: string; emoji: string };
        location?: { latitude: number; longitude: number; name?: string; address?: string };
        contacts?: Array<{ name: { formatted_name: string }; phones?: Array<{ phone: string }> }>;
        referral?: {
          source_url?: string;
          source_type?: string;  // 'ad' | 'post'
          source_id?: string;
          headline?: string;
          body?: string;
          image_url?: string;
          media_type?: string;  // 'image' | 'video'
          ctwa_clid?: string;
        };
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

@SkipThrottle()
@ApiTags('WhatsApp Webhook')
@Controller('webhook/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private prisma: PrismaService,
    private messagesService: MessagesService,
    @Inject(forwardRef(() => CallsService)) private callsService: CallsService,
  ) {}

  @Get(':tenantId')
  async verify(
    @Param('tenantId') tenantId: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { webhookVerifyToken: true },
    });

    if (mode === 'subscribe' && tenant && token === tenant.webhookVerifyToken) {
      this.logger.log(`Webhook verified for tenant ${tenantId}`);
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  }

  /**
   * Verifies Meta's x-hub-signature-256 against WHATSAPP_APP_SECRET before any
   * tenant fan-out. All tenants are onboarded under this app's single WABA
   * embedded-signup flow (confirmed: wabaId/accessToken are per-tenant, but the
   * App Secret belongs to the one Meta App those WABAs are connected through),
   * so one global secret is correct here, not a per-tenant one.
   *
   * Fails OPEN (logs and continues) when WHATSAPP_APP_SECRET isn't configured,
   * rather than closed -- this is a new check being added to a controller that
   * has never verified signatures before, and failing closed with no secret
   * provisioned yet would silently stop all inbound WhatsApp processing for
   * every tenant the moment this ships. Only rejects once the secret is
   * actually set and the signature genuinely doesn't match.
   */
  private assertValidSignature(raw: Buffer | undefined, signature: string | undefined): void {
    const appSecret = process.env['WHATSAPP_APP_SECRET'];
    if (!appSecret) {
      this.logger.warn('WHATSAPP_APP_SECRET not configured -- webhook signature verification is disabled');
      return;
    }
    if (!verifyWhatsAppSignature(raw, signature, appSecret)) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  @Post(':tenantId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('tenantId') tenantId: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: { object: string; entry: WebhookEntry[] },
    @Headers('x-hub-signature-256') signature: string,
  ) {
    this.assertValidSignature(req.rawBody, signature);
    if (body.object !== 'whatsapp_business_account') return { status: 'ok' };

    // Collect all phone_number_ids present in this webhook batch.
    // Meta always includes metadata.phone_number_id so we can resolve the
    // canonical owner(s) regardless of which slug the webhook was registered under.
    const phoneNumberIds = new Set<string>();
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const pid = change.value?.metadata?.phone_number_id;
        if (pid) phoneNumberIds.add(pid);
      }
    }

    // Find every active tenant that owns any of these phone numbers.
    // This is the fan-out: if tenant A and tenant B both configured the same
    // phoneNumberId, both will receive and process this webhook.
    let tenants: Array<{ id: string }> = [];
    if (phoneNumberIds.size > 0) {
      tenants = await this.prisma.tenant.findMany({
        where: { phoneNumberId: { in: [...phoneNumberIds] }, isActive: true },
        select: { id: true },
      });
      this.logger.debug(
        `Webhook phone_number_ids [${[...phoneNumberIds].join(', ')}] → ${tenants.length} matching tenant(s)`,
      );
    }

    // Fallback: if no tenant matched by phoneNumberId (e.g. number not yet saved),
    // resolve by tenant ID directly.
    if (tenants.length === 0) {
      const fallback = await this.prisma.tenant.findUnique({
        where: { id: tenantId, isActive: true },
        select: { id: true },
      });
      if (!fallback) return { status: 'ok' };
      tenants = [fallback];
      this.logger.debug(`Webhook ID fallback for ${tenantId}`);
    }

    // Process the full webhook payload for each matched tenant.
    for (const tenant of tenants) {
      await this.processWebhookForTenant(tenant.id, body.entry ?? []);
    }

    return { status: 'ok' };
  }

  private async processWebhookForTenant(tenantId: string, entries: WebhookEntry[]) {
    for (const entry of entries) {
      for (const change of entry.changes) {
        this.logger.log(`[webhook] field=${change.field} tenant=${tenantId}`);

        // Handle call status updates from WhatsApp Calling API
        if (change.field === 'calls') {
          this.logger.log(`[webhook] calls payload: ${JSON.stringify(change.value)}`);
          if (!change.value.calls?.length) continue;
          try {
            await this.callsService.handleCallWebhook(tenantId, change.value.calls);
          } catch (error) {
            this.logger.error(`[tenant:${tenantId}] Failed to process call webhook: ${error instanceof Error ? error.message : String(error)}`);
          }
          continue;
        }

        if (change.field !== 'messages') continue;

        const value = change.value;
        // Which phone number received this batch — used to tag conversations
        const incomingPhoneNumberId = value.metadata?.phone_number_id;

        if (value.messages?.length) {
          const profileName = value.contacts?.[0]?.profile?.name;
          for (const message of value.messages) {
            try {
              await this.messagesService.handleInbound(tenantId, message, profileName, incomingPhoneNumberId, message.referral);
            } catch (error) {
              const errMessage = error instanceof Error ? error.message : String(error);
              this.logger.error(`[tenant:${tenantId}] Failed to process inbound message ${message.id}: ${errMessage}`);
              void notify({
                source: 'backend',
                tenantId,
                message: `Failed to process inbound WhatsApp message: ${errMessage}`,
                stack: error instanceof Error ? error.stack : undefined,
              }).catch(() => {});
            }
          }
        }

        if (value.statuses?.length) {
          for (const statusUpdate of value.statuses) {
            const status = STATUS_MAP[statusUpdate.status];
            if (status) {
              try {
                await this.messagesService.updateStatus(statusUpdate.id, status, tenantId, statusUpdate.errors);
              } catch (error) {
                this.logger.warn(
                  `[tenant:${tenantId}] Failed to update message status ${statusUpdate.id}: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }
          }
        }
      }
    }
  }
}
