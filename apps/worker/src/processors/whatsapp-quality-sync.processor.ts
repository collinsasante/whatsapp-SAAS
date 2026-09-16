import { Worker, Queue, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours -- quality rating changes rarely
const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';

/**
 * WhatsApp Quality Sync -- periodically fetches each active WhatsAppNumber's
 * quality_rating/messaging_limit_tier from Meta's Graph API and persists it
 * (previously only ever fetched live and discarded, see
 * WhatsAppService.getBusinessProfile) so the analytics health endpoint has
 * real history to show rather than fetching live on every page load.
 */
export class WhatsAppQualitySyncWorker {
  private worker?: Worker;
  private queue?: Queue;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  async start() {
    this.queue = new Queue('whatsapp-quality-sync', { connection: this.connection });

    await this.queue.add(
      'sync',
      {},
      {
        repeat: { every: SYNC_INTERVAL_MS },
        jobId: 'whatsapp-quality-sync-repeatable',
        removeOnComplete: 5,
        removeOnFail: 5,
      },
    );

    this.worker = new Worker<Record<string, never>>(
      'whatsapp-quality-sync',
      this.process.bind(this),
      { connection: this.connection, concurrency: 2 },
    );

    this.worker.on('failed', (_job: Job | undefined, err: Error) => {
      console.error('[WhatsAppQualitySync] Job failed:', err.message);
    });

    console.log('[WhatsAppQualitySync] Worker started — syncing every 6h');
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process() {
    const numbers = await this.prisma.whatsAppNumber.findMany({
      where: { isActive: true },
      select: { id: true, phoneNumberId: true, accessToken: true },
    });

    for (const number of numbers) {
      try {
        const res = await axios.get(`${GRAPH_API_BASE}/${number.phoneNumberId}`, {
          params: { fields: 'quality_rating,messaging_limit_tier' },
          headers: { Authorization: `Bearer ${number.accessToken}` },
          timeout: 10_000,
        });

        await this.prisma.whatsAppNumber.update({
          where: { id: number.id },
          data: {
            qualityRating: res.data.quality_rating ?? null,
            messagingLimitTier: res.data.messaging_limit_tier ?? null,
            qualitySyncedAt: new Date(),
          },
        });
      } catch (err) {
        console.error(`[WhatsAppQualitySync] Failed for number ${number.id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }
}
