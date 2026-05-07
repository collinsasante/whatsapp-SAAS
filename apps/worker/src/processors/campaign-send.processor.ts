import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MessageStatus, MessageDirection, MessageType } from '@whatsapp-platform/shared-types';
import axios from 'axios';
import { QueueName, CampaignSendJob } from '@whatsapp-platform/shared-types';
import { buildTemplateComponents } from '@whatsapp-platform/shared-utils';

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';
const RATE_LIMIT_DELAY_MS = 1000;

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
      console.error(`Campaign job ${job?.id} failed:`, err.message);
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

    if (!campaign || campaign.status === 'PAUSED') {
      console.log(`Campaign ${campaignId} is paused or not found, skipping batch`);
      return;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { phoneNumberId: true, accessToken: true },
    });

    if (!tenant?.phoneNumberId || !tenant?.accessToken) {
      throw new Error('WhatsApp not configured for tenant');
    }

    const recipients = await this.prisma.campaignRecipient.findMany({
      where: { id: { in: recipientIds }, status: 'PENDING' },
      include: { contact: true },
    });

    for (const recipient of recipients) {
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
        const components = buildTemplateComponents(campaign.template.components as never, templateVariables);

        const response = await axios.post(
          `${GRAPH_API_BASE}/${tenant.phoneNumberId}/messages`,
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
              Authorization: `Bearer ${tenant.accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          },
        );

        const whatsappMessageId = response.data.messages[0].id as string;

        const message = await this.prisma.message.create({
          data: {
            tenantId,
            conversationId: await this.getOrCreateConversation(tenantId, recipient.contactId),
            contactId: recipient.contactId,
            whatsappMessageId,
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

        await this.prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'FAILED', errorMessage: errorMsg },
        });

        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { failedCount: { increment: 1 } },
        });
      }
    }

    await this.checkAndCompleteIfDone(campaignId);
  }

  private async getOrCreateConversation(tenantId: string, contactId: string): Promise<string> {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId, status: { not: 'RESOLVED' } },
    });

    if (existing) return existing.id;

    const created = await this.prisma.conversation.create({
      data: { tenantId, contactId },
    });

    return created.id;
  }

  private async checkAndCompleteIfDone(campaignId: string) {
    const pending = await this.prisma.campaignRecipient.count({
      where: { campaignId, status: 'PENDING' },
    });

    if (pending === 0) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
