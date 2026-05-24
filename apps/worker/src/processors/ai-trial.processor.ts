import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { QueueName, AiTrialExpireJob } from '@whatsapp-platform/shared-types';

const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://backend:3001';

export class AiTrialWorker {
  private worker?: Worker;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  start() {
    this.worker = new Worker<AiTrialExpireJob>(
      QueueName.AI_TRIAL,
      this.process.bind(this),
      { connection: this.connection, concurrency: 3 },
    );

    this.worker.on('failed', (job, err) => {
      console.error(`AI trial job ${job?.id} failed:`, err.message);
    });

    console.log('AI trial worker started');
  }

  async stop() {
    await this.worker?.close();
  }

  private async process(job: Job<AiTrialExpireJob>) {
    const { tenantId } = job.data;

    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { aiEnabled: true, aiTrialApprovedAt: true, aiTrialStartedAt: true },
    });

    // Already approved or AI was disabled — skip
    if (!settings || settings.aiTrialApprovedAt || !settings.aiTrialStartedAt) return;

    // Pause AI — requires admin approval to resume
    await this.prisma.tenantSettings.update({
      where: { tenantId },
      data: { aiEnabled: false },
    });

    const internalSecret = process.env['INTERNAL_SECRET'] ?? '';

    // Notify all admins in-app via backend internal endpoint
    await axios.post(
      `${BACKEND_URL}/manage/settings/ai/trial-expired`,
      { tenantId },
      { headers: { 'x-internal-secret': internalSecret }, timeout: 10000 },
    ).catch((err) => {
      console.error(`Failed to send AI trial expiry notification for ${tenantId}:`, err.message);
    });
  }
}
