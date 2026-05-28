import { Worker, Queue, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const REALTIME_URL = process.env['REALTIME_INTERNAL_URL'] ?? 'http://realtime:3002';
const CHECK_INTERVAL_MS = 60_000; // every 60 seconds

/**
 * SLA Monitor — runs as a repeatable job every minute.
 * Finds conversations whose slaDeadline has passed and whose status
 * is still REQUESTED or INTERVENED, emits a real-time breach alert
 * to the assigned agent (or all admins), and marks the conversation
 * so it won't fire again until the SLA is reset.
 */
export class SlaMonitorWorker {
  private worker?: Worker;
  private queue?: Queue;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  async start() {
    this.queue = new Queue('sla-monitor', { connection: this.connection });

    // Schedule a repeatable job — one instance across all worker replicas
    await this.queue.add(
      'check',
      {},
      {
        repeat: { every: CHECK_INTERVAL_MS },
        jobId: 'sla-monitor-repeatable',
        removeOnComplete: 5,
        removeOnFail: 5,
      },
    );

    this.worker = new Worker<Record<string, never>>(
      'sla-monitor',
      this.process.bind(this),
      { connection: this.connection, concurrency: 1 },
    );

    this.worker.on('failed', (_job: Job | undefined, err: Error) => {
      console.error('[SlaMonitor] Job failed:', err.message);
    });

    console.log('[SlaMonitor] Worker started — checking every 60s');
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process() {
    const now = new Date();

    // Find conversations that have breached SLA and haven't been marked yet
    const breached = await this.prisma.conversation.findMany({
      where: {
        slaDeadline: { lte: now },
        status: { in: ['REQUESTED', 'INTERVENED'] },
        slaBreached: false,
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        slaDeadline: true,
        assignedToId: true,
        contactId: true,
      },
      take: 200,
    });

    if (!breached.length) return;

    console.log(`[SlaMonitor] ${breached.length} SLA breach(es) found`);

    await Promise.all(
      breached.map(async (conv) => {
        try {
          // Mark as breached so we don't re-fire
          await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { slaBreached: true },
          });

          // Emit real-time alert to the tenant room (all connected agents/admins see it)
          await axios.post(
            `${REALTIME_URL}/internal/emit`,
            {
              tenantId: conv.tenantId,
              event: 'sla:breach',
              data: {
                conversationId: conv.id,
                contactId: conv.contactId,
                status: conv.status,
                deadline: conv.slaDeadline,
                assignedToId: conv.assignedToId,
              },
            },
            { timeout: 5000 },
          );
        } catch (err) {
          console.error(`[SlaMonitor] Failed to process breach for conv ${conv.id}:`, err instanceof Error ? err.message : String(err));
        }
      }),
    );
  }
}
