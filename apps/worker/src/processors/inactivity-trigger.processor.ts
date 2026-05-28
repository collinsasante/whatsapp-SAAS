import { Worker, Queue, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { QueueName } from '@whatsapp-platform/shared-types';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

/**
 * Inactivity Trigger Worker — runs every 30 minutes.
 *
 * For each INACTIVITY automation rule, the rule's conditions include
 * { field: 'inactivityHours', operator: 'equals', value: '24' } (or similar).
 * We find open conversations whose last inbound message is older than
 * that many hours, haven't already been triggered by this rule
 * (tracked via a AUTOMATION_TRIGGERED activity log entry), and queue
 * an automation job for each match.
 */
export class InactivityTriggerWorker {
  private worker?: Worker;
  private queue?: Queue;
  private automationQueue?: Queue;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  async start() {
    this.queue = new Queue('inactivity-trigger', { connection: this.connection });
    this.automationQueue = new Queue(QueueName.AUTOMATION_TRIGGER, { connection: this.connection });

    await this.queue.add('check', {}, {
      repeat: { every: CHECK_INTERVAL_MS },
      jobId: 'inactivity-trigger-repeatable',
      removeOnComplete: 3,
      removeOnFail: 3,
    });

    this.worker = new Worker<Record<string, never>>(
      'inactivity-trigger',
      this.process.bind(this),
      { connection: this.connection, concurrency: 1 },
    );

    this.worker.on('failed', (_job: Job | undefined, err: Error) => {
      console.error('[InactivityTrigger] Job failed:', err.message);
    });

    console.log('[InactivityTrigger] Worker started — checking every 30 min');
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
    await this.automationQueue?.close();
  }

  private async process() {
    // Find all active INACTIVITY rules across all tenants
    const rules = await this.prisma.automationRule.findMany({
      where: { trigger: 'INACTIVITY' as never, isActive: true },
      select: { id: true, tenantId: true, conditions: true },
    });

    if (!rules.length) return;

    for (const rule of rules) {
      try {
        // Parse inactivity hours from the rule's conditions
        // Expected: [{ field: 'inactivityHours', operator: 'equals', value: '24' }]
        const conditions = rule.conditions as Array<{ field: string; operator: string; value: string }>;
        const hoursCond = conditions.find((c) => c.field === 'inactivityHours');
        const inactivityHours = hoursCond ? parseInt(hoursCond.value, 10) : 24;
        if (isNaN(inactivityHours) || inactivityHours <= 0) continue;

        const cutoff = new Date(Date.now() - inactivityHours * 60 * 60 * 1000);

        // Find open conversations with no inbound message since the cutoff
        const staleConversations = await this.prisma.conversation.findMany({
          where: {
            tenantId: rule.tenantId,
            status: { in: ['OPEN', 'INTERVENED'] as never[] },
            lastMessageAt: { lte: cutoff, not: null },
          },
          select: { id: true, contactId: true },
          take: 100,
        });

        for (const conv of staleConversations) {
          // Deduplicate: skip if this rule already fired for this conversation recently
          const alreadyFired = await this.prisma.activityLog.findFirst({
            where: {
              tenantId: rule.tenantId,
              conversationId: conv.id,
              action: 'AUTOMATION_TRIGGERED',
              metadata: { path: ['ruleId'], equals: rule.id },
              createdAt: { gte: cutoff },
            },
          });
          if (alreadyFired) continue;

          await this.automationQueue!.add('trigger', {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            conversationId: conv.id,
            contactId: conv.contactId,
          }, { attempts: 2, backoff: { type: 'fixed', delay: 5000 } });
        }
      } catch (err) {
        console.error(`[InactivityTrigger] Error processing rule ${rule.id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }
}
