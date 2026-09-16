import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MessageStatus } from '@whatsapp-platform/shared-types';
import axios from 'axios';
import { QueueName, MessageRetryJob } from '@whatsapp-platform/shared-types';
import { resolveWhatsAppCredentials, GRAPH_API_BASE } from '../lib/whatsapp-credentials';

const MAX_RETRIES = 3;

export class MessageRetryWorker {
  private worker?: Worker;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  start() {
    this.worker = new Worker<MessageRetryJob>(
      QueueName.MESSAGE_RETRY,
      this.process.bind(this),
      {
        connection: this.connection,
        concurrency: 3,
      },
    );

    this.worker.on('failed', (job, err) => {
      console.error(`Message retry job ${job?.id} failed:`, err.message);
    });

    console.log('Message retry worker started');
  }

  async stop() {
    await this.worker?.close();
  }

  private async process(job: Job<MessageRetryJob>) {
    const { messageId, tenantId, attempt } = job.data;

    if (attempt >= MAX_RETRIES) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.FAILED,
          failedAt: new Date(),
          failureReason: 'Max retry attempts exceeded',
        },
      });
      return;
    }

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId },
      include: { contact: true },
    });

    if (!message || message.status !== MessageStatus.FAILED) return;

    // Retry from the exact number the original send used, not whichever
    // number happens to be the tenant's current default -- otherwise a
    // retry could go out under a completely different WhatsApp identity
    // than the one the customer actually messaged.
    const credentials = await resolveWhatsAppCredentials(this.prisma, tenantId, message.whatsappNumberId);

    if (!credentials) return;

    try {
      const response = await axios.post(
        `${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: message.contact.phone,
          type: 'text',
          text: { body: message.content ?? '' },
        },
        {
          headers: { Authorization: `Bearer ${credentials.accessToken}` },
          timeout: 15000,
        },
      );

      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          whatsappMessageId: response.data.messages[0].id as string,
          status: MessageStatus.SENT,
          sentAt: new Date(),
          failureReason: null,
        },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.prisma.message.update({
        where: { id: messageId },
        data: { failureReason: `Attempt ${attempt + 1}: ${errorMsg}` },
      });
      throw error;
    }
  }
}
