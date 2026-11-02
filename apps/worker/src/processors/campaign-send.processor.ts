import { assertNotSimulatedRecipient } from '@whatsapp-platform/shared-utils';
import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MessageStatus, MessageDirection, MessageType } from '@whatsapp-platform/shared-types';
import axios from 'axios';
import { QueueName, CampaignSendJob } from '@whatsapp-platform/shared-types';
import { buildTemplateComponents } from '@whatsapp-platform/shared-utils';
import { randomBytes } from 'crypto';
import { resolveWhatsAppCredentials, GRAPH_API_BASE } from '../lib/whatsapp-credentials';

const RATE_LIMIT_DELAY_MS = 1000;
const PUBLIC_BASE_URL = process.env['PUBLIC_BASE_URL'] ?? 'https://verzchat.com/api/v1';

export class CampaignSendWorker {
  private worker?: Worker;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  start() {
    this.worker = new Worker<CampaignSendJob>(
      QueueName.CAMPAIGN_SEND,
      this.process.bind(this),
      {
        connection: this.connection,
        concurrency: 2,
        limiter: { max: 20, duration: 1000 },
      },
    );

    this.worker.on('failed', (job, err) => {
      console.error(`Campaign job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts ?? 1}):`, err.message);
      // BullMQ retries a thrown error up to `attempts` times. On the last one nothing will try again, so the batch's recipients
      // must reach a terminal state here, otherwise the campaign would stay RUNNING with PENDING recipients forever.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.failBatch(job.data, `Sending failed after ${job.attemptsMade} attempts: ${err.message}`).catch((e) => {
          console.error(`Could not close out failed batch of campaign ${job.data.campaignId}:`, e instanceof Error ? e.message : String(e));
        });
      }
    });

    this.worker.on('completed', (job) => {
      console.log(`Campaign batch ${job.data.batchIndex} for campaign ${job.data.campaignId} completed`);
    });

    console.log('Campaign send worker started');
  }

  async stop() {
    await this.worker?.close();
  }

  private async process(job: Job<CampaignSendJob>) {
    const { campaignId, tenantId, recipientIds } = job.data;

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: { template: true },
    });

    if (!campaign || campaign.status !== 'RUNNING') {
      // Paused, deleted, or already finished (COMPLETED / FAILED): never send for a campaign that is not running.
      console.log(`Campaign ${campaignId} is ${campaign?.status ?? 'not found'}, skipping batch`);
      return;
    }

    // null whatsappNumberId means "use the tenant's default number" --
    // backward compatible with every campaign created before multi-account
    // support existed.
    const credentials = await resolveWhatsAppCredentials(this.prisma, tenantId, campaign.whatsappNumberId);

    if (!credentials) {
      // Permanent: retrying cannot fix missing credentials, so the batch is closed out now instead of retried and then abandoned.
      console.error(`Campaign ${campaignId}: WhatsApp credentials are missing or invalid for this campaign's number; failing the batch`);
      await this.failBatch(job.data, "WhatsApp is not configured for this campaign's number");
      return;
    }

    const recipients = await this.prisma.campaignRecipient.findMany({
      where: { id: { in: recipientIds }, campaignId, status: 'PENDING' },
      include: { contact: true },
    });

    for (const recipient of recipients) {
      // A pause (or any other change) must take effect inside a running batch, not only at the next one; otherwise a resumed
      // campaign could be re-queued while this batch is still sending the same recipients.
      const current = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
      if (current?.status !== 'RUNNING') {
        console.log(`Campaign ${campaignId} is ${current?.status ?? 'gone'}; stopping this batch before recipient ${recipient.id}`);
        return;
      }

      if (recipient.contact.isBlocked || recipient.contact.optedOut) {
        await this.prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'FAILED', errorMessage: 'Contact blocked or opted out' },
        });
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { failedCount: { increment: 1 } },
        });
        continue;
      }

      try {
        const templateVariables = (campaign.templateVariables as Record<string, string>) ?? {};

        // Generate a per-recipient click tracking code if campaign has a tracking URL
        let trackingCode: string | null = null;
        if (campaign.trackingUrl) {
          trackingCode = randomBytes(8).toString('hex');
          await this.prisma.campaignClick.create({
            data: { campaignId, contactId: recipient.contactId, code: trackingCode },
          });
          // Inject the short tracking URL as an extra variable so templates can include it
          templateVariables['tracking_url'] = `${PUBLIC_BASE_URL}/c/${trackingCode}`;
        }

        const components = buildTemplateComponents(campaign.template.components as never, templateVariables);
        assertNotSimulatedRecipient(recipient.contact.phone); // a simulated number never reaches Meta

        const response = await axios.post(
          `${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: recipient.contact.phone,
            type: 'template',
            template: {
              name: campaign.template.name,
              language: { code: campaign.template.language },
              components,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${credentials.accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          },
        );

        const whatsappMessageId = response.data.messages[0].id as string;

        const message = await this.prisma.message.create({
          data: {
            tenantId,
            conversationId: await this.getOrCreateConversation(tenantId, recipient.contactId, campaign.whatsappNumberId),
            contactId: recipient.contactId,
            whatsappMessageId,
            whatsappNumberId: campaign.whatsappNumberId,
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEMPLATE,
            status: MessageStatus.SENT,
            templateId: campaign.templateId,
            templateVariables: campaign.templateVariables ?? undefined,
            sentAt: new Date(),
          },
        });

        await this.prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'SENT', messageId: message.id, sentAt: new Date() },
        });

        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { sentCount: { increment: 1 } },
        });

        await this.sleep(RATE_LIMIT_DELAY_MS);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        // Meta's Graph API error shape: { error: { message, type, code, error_subcode, fbtrace_id } }
        const errorCode = axios.isAxiosError(error)
          ? (error.response?.data as { error?: { code?: number } } | undefined)?.error?.code ?? null
          : null;

        await this.prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'FAILED', errorMessage: errorMsg, errorCode },
        });

        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { failedCount: { increment: 1 } },
        });
      }
    }

    await this.checkAndCompleteIfDone(campaignId);
  }

  private async getOrCreateConversation(tenantId: string, contactId: string, whatsappNumberId?: string | null): Promise<string> {
    // Same dedup rule as ConversationsService.findOrCreate (apps/backend): match
    // this number's own open conversation or a legacy untagged one, never a
    // different number's -- so a campaign sent from "Sales" doesn't land in a
    // thread the contact has open with "Support".
    const existing = await this.prisma.conversation.findFirst({
      where: {
        tenantId,
        contactId,
        status: { not: 'RESOLVED' },
        ...(whatsappNumberId && { OR: [{ whatsappNumberId }, { whatsappNumberId: null }] }),
      },
    });

    if (existing) {
      if (whatsappNumberId && !existing.whatsappNumberId) {
        await this.prisma.conversation.update({ where: { id: existing.id }, data: { whatsappNumberId } });
      }
      return existing.id;
    }

    const created = await this.prisma.conversation.create({
      data: { tenantId, contactId, whatsappNumberId },
    });

    return created.id;
  }

  /** Marks this batch's still-PENDING recipients FAILED (never touching SENT ones), counts them, and settles the campaign. */
  private async failBatch(data: CampaignSendJob, reason: string) {
    const { campaignId, tenantId, recipientIds } = data;
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { id: true } });
    if (!campaign) return;
    const { count } = await this.prisma.campaignRecipient.updateMany({
      where: { id: { in: recipientIds }, campaignId, status: 'PENDING' },
      data: { status: 'FAILED', errorMessage: reason.slice(0, 500) },
    });
    if (count > 0) {
      await this.prisma.campaign.update({ where: { id: campaignId }, data: { failedCount: { increment: count } } });
    }
    await this.checkAndCompleteIfDone(campaignId);
  }

  /**
   * Settles a campaign once no recipient is PENDING. Every recipient is SENT or FAILED by then, so: nothing sent and something
   * failed = FAILED; otherwise COMPLETED (failedCount > 0 means partially completed). Only a RUNNING campaign is settled, so a
   * paused or deleted campaign is never overwritten.
   */
  private async checkAndCompleteIfDone(campaignId: string) {
    const pending = await this.prisma.campaignRecipient.count({
      where: { campaignId, status: 'PENDING' },
    });
    if (pending > 0) return;

    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true, sentCount: true, failedCount: true } });
    if (!campaign || campaign.status !== 'RUNNING') return;
    const status = campaign.sentCount === 0 && campaign.failedCount > 0 ? 'FAILED' : 'COMPLETED';
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status, completedAt: new Date() },
    });
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
