import { Worker, Queue, Job } from 'bullmq';
import { ChannelType, Prisma, PrismaClient } from '@prisma/client';
import { parseEncryptionKey, runTikTokRefreshCycle, TikTokRefreshStore } from '@whatsapp-platform/shared-utils';

const CHECK_INTERVAL_MS = 10 * 60_000; // access tokens last about two hours and are refreshed when under 30 minutes remain
const ENCRYPTION_KEY = parseEncryptionKey(process.env['CREDENTIALS_ENCRYPTION_KEY']);

/**
 * TikTok token refresh. Access tokens are short lived and refresh tokens rotate, so without this a connected TikTok account silently stops
 * working a couple of hours after it was connected. The logic lives in shared-utils (runTikTokRefreshCycle) where it is unit tested; this class
 * only schedules it and adapts Prisma to the store interface. Reconnect-needed state is recorded in Channel.metadata.tiktokAuth.
 */
export class TikTokTokenRefreshWorker {
  private worker?: Worker;
  private queue?: Queue;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  async start() {
    this.queue = new Queue('tiktok-token-refresh', { connection: this.connection });
    await this.queue.add('refresh', {}, {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: 'tiktok-token-refresh-repeatable',
      removeOnComplete: 5,
      removeOnFail: 5,
    });
    // concurrency 1: one refresh pass at a time, so one rotated token can never be written over by a parallel pass
    this.worker = new Worker('tiktok-token-refresh', this.process.bind(this), { connection: this.connection, concurrency: 1 });
    this.worker.on('failed', (_job: Job | undefined, err: Error) => {
      console.error('[TikTokTokenRefresh] Job failed:', err.message);
    });
    console.log('[TikTokTokenRefresh] Worker started — checking every 10 minutes');
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private store(): TikTokRefreshStore {
    const prisma = this.prisma;
    const asRecord = (v: Prisma.JsonValue | null): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
    return {
      async listActive() {
        const rows = await prisma.channel.findMany({ where: { type: ChannelType.TIKTOK, isActive: true }, select: { id: true, tenantId: true, credentials: true } });
        // Business Messaging connections use a different token endpoint and are renewed by the backend when used; refreshing them here with the Login Kit endpoint would fail.
        return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, credentials: asRecord(r.credentials) })).filter((r) => r.credentials['kind'] !== 'business_messaging');
      },
      async saveRefreshed(id, expectedRefreshToken, credentials) {
        const current = await prisma.channel.findUnique({ where: { id }, select: { metadata: true } });
        const { tiktokAuth: _cleared, ...restMetadata } = asRecord(current?.metadata ?? null);
        void _cleared;
        const res = await prisma.channel.updateMany({
          where: { id, credentials: { path: ['refreshToken'], equals: expectedRefreshToken } },
          data: { credentials: credentials as Prisma.InputJsonValue, metadata: restMetadata as Prisma.InputJsonValue },
        });
        return res.count === 1;
      },
      async markReauthRequired(id, info) {
        const current = await prisma.channel.findUnique({ where: { id }, select: { metadata: true } });
        await prisma.channel.update({
          where: { id },
          data: { metadata: { ...asRecord(current?.metadata ?? null), tiktokAuth: { status: 'REAUTH_REQUIRED', ...info } } as Prisma.InputJsonValue },
        });
      },
    };
  }

  private async process() {
    const summary = await runTikTokRefreshCycle({
      store: this.store(),
      fetchFn: fetch,
      key: ENCRYPTION_KEY,
      clientKey: process.env['TIKTOK_CLIENT_ID'],
      clientSecret: process.env['TIKTOK_CLIENT_SECRET'],
      log: {
        info: (m) => console.log(`[TikTokTokenRefresh] ${m}`),
        warn: (m) => console.warn(`[TikTokTokenRefresh] ${m}`),
        error: (m) => console.error(`[TikTokTokenRefresh] ${m}`),
      },
    });
    if (summary.checked > 0) console.log(`[TikTokTokenRefresh] pass: ${JSON.stringify(summary)}`);
  }
}
