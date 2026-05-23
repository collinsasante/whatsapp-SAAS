import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { QueueName, SnoozeWakeJob } from '@whatsapp-platform/shared-types';

const REALTIME_URL = process.env['REALTIME_URL'] ?? 'http://realtime:3002';

const CONV_INCLUDE = {
  contact: true,
  assignedTo: { select: { id: true, name: true, avatarUrl: true } },
  channel: { select: { id: true, type: true, name: true } },
};

export class SnoozeWorker {
  private worker?: Worker;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  start() {
    this.worker = new Worker<SnoozeWakeJob>(
      QueueName.SNOOZE,
      this.process.bind(this),
      { connection: this.connection, concurrency: 5 },
    );

    this.worker.on('failed', (job, err) => {
      console.error(`Snooze job ${job?.id} failed:`, err.message);
    });

    console.log('Snooze worker started');
  }

  async stop() {
    await this.worker?.close();
  }

  private async process(job: Job<SnoozeWakeJob>) {
    const { conversationId, tenantId } = job.data;

    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });

    // Already unsnooze or missing — skip
    if (!conv || !conv.snoozedUntil) return;

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { snoozedUntil: null },
      include: CONV_INCLUDE,
    });

    await axios.post(
      `${REALTIME_URL}/internal/emit`,
      {
        event: 'conversation_unsnooze',
        payload: { conversationId, ...updated, tenantId },
      },
      { timeout: 5000 },
    ).catch((err) => {
      console.error(`Failed to emit conversation_unsnooze for ${conversationId}:`, err.message);
    });
  }
}
