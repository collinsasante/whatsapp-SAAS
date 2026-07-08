import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/** Not registered in shared-types' QueueName enum -- added directly in the worker without updating the shared enum. Included here by string so their health is still visible. */
const PLATFORM_ROLLUP_QUEUE = 'platform-rollup';
const INACTIVITY_TRIGGER_QUEUE = 'inactivity-trigger';

/**
 * Rough, clearly-labeled gross-margin estimate: WhatsApp/Meta charges per
 * conversation (not per message), with rates varying by category and country
 * -- far too granular to model precisely here. This assumes a flat rate per
 * conversation as a directional signal only, not a real cost accounting figure.
 */
const ESTIMATED_COST_PER_CONVERSATION_USD = 0.02;

@Injectable()
export class PlatformHealthService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.CAMPAIGN_SEND) private campaignSendQueue: Queue,
    @InjectQueue(QueueName.MESSAGE_RETRY) private messageRetryQueue: Queue,
    @InjectQueue(QueueName.AUTOMATION_TRIGGER) private automationQueue: Queue,
    @InjectQueue(QueueName.SCHEDULED_CAMPAIGN) private scheduledCampaignQueue: Queue,
    @InjectQueue(QueueName.SNOOZE) private snoozeQueue: Queue,
    @InjectQueue(QueueName.AI_TRIAL) private aiTrialQueue: Queue,
    @InjectQueue(QueueName.SLA_MONITOR) private slaMonitorQueue: Queue,
    @InjectQueue(QueueName.ANALYTICS_ROLLUP) private analyticsRollupQueue: Queue,
    @InjectQueue(QueueName.WHATSAPP_QUALITY_SYNC) private whatsappQualitySyncQueue: Queue,
    @InjectQueue(PLATFORM_ROLLUP_QUEUE) private platformRollupQueue: Queue,
    @InjectQueue(INACTIVITY_TRIGGER_QUEUE) private inactivityTriggerQueue: Queue,
  ) {}

  private get queues(): { name: string; queue: Queue }[] {
    return [
      { name: QueueName.CAMPAIGN_SEND, queue: this.campaignSendQueue },
      { name: QueueName.MESSAGE_RETRY, queue: this.messageRetryQueue },
      { name: QueueName.AUTOMATION_TRIGGER, queue: this.automationQueue },
      { name: QueueName.SCHEDULED_CAMPAIGN, queue: this.scheduledCampaignQueue },
      { name: QueueName.SNOOZE, queue: this.snoozeQueue },
      { name: QueueName.AI_TRIAL, queue: this.aiTrialQueue },
      { name: QueueName.SLA_MONITOR, queue: this.slaMonitorQueue },
      { name: QueueName.ANALYTICS_ROLLUP, queue: this.analyticsRollupQueue },
      { name: QueueName.WHATSAPP_QUALITY_SYNC, queue: this.whatsappQualitySyncQueue },
      { name: PLATFORM_ROLLUP_QUEUE, queue: this.platformRollupQueue },
      { name: INACTIVITY_TRIGGER_QUEUE, queue: this.inactivityTriggerQueue },
    ];
  }

  private async getQueueHealth() {
    return Promise.all(
      this.queues.map(async ({ name, queue }) => {
        try {
          const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
          return { name, ...counts, reachable: true };
        } catch {
          // Redis unreachable or queue never had a job yet -- report clearly rather than crashing the whole endpoint
          return { name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, reachable: false };
        }
      }),
    );
  }

  private async getWhatsAppQualitySummary() {
    const numbers = await this.prisma.whatsAppNumber.findMany({
      where: { isActive: true },
      select: { qualityRating: true },
    });
    const summary = { GREEN: 0, YELLOW: 0, RED: 0, UNKNOWN: 0 };
    for (const n of numbers) {
      const key = (n.qualityRating as keyof typeof summary) ?? 'UNKNOWN';
      summary[key in summary ? key : 'UNKNOWN']++;
    }
    return { total: numbers.length, ...summary };
  }

  /** Error rate over time -- derived from the existing per-tenant message rollup (failedCount/sentCount), summed cross-tenant per day. */
  private async getErrorRateTrend(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.analyticsDailyMessageStats.groupBy({
      by: ['date'],
      where: { date: { gte: since } },
      _sum: { sentCount: true, failedCount: true },
    });
    return rows
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((r) => {
        const sent = r._sum.sentCount ?? 0;
        const failed = r._sum.failedCount ?? 0;
        return {
          date: r.date.toISOString().slice(0, 10),
          sent, failed,
          errorRatePct: sent + failed > 0 ? Math.round((failed / (sent + failed)) * 1000) / 10 : 0,
        };
      });
  }

  /**
   * Rough per-tenant gross-margin estimate: estimated Meta conversation cost
   * (flat assumed rate, see ESTIMATED_COST_PER_CONVERSATION_USD) vs. collected
   * revenue, for the last 30 days. Directional only -- not real cost accounting.
   */
  private async getCostEstimatePerTenant() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [conversationCounts, revenueCounts] = await Promise.all([
      this.prisma.conversation.groupBy({ by: ['tenantId'], where: { createdAt: { gte: thirtyDaysAgo } }, _count: { id: true } }),
      this.prisma.payment.groupBy({ by: ['tenantId'], where: { status: 'SUCCEEDED', createdAt: { gte: thirtyDaysAgo } }, _sum: { amount: true } }),
    ]);
    const revenueByTenant = new Map(revenueCounts.map((r) => [r.tenantId, r._sum.amount ?? 0]));
    const tenantIds = [...new Set([...conversationCounts.map((c) => c.tenantId), ...revenueCounts.map((r) => r.tenantId)])];
    if (tenantIds.length === 0) return [];

    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } });
    const nameByTenant = new Map(tenants.map((t) => [t.id, t.name]));

    return conversationCounts
      .map((c) => {
        const estimatedCostUsd = Math.round(c._count.id * ESTIMATED_COST_PER_CONVERSATION_USD * 100) / 100;
        const revenue = revenueByTenant.get(c.tenantId) ?? 0;
        return {
          tenantId: c.tenantId, tenantName: nameByTenant.get(c.tenantId) ?? 'Unknown',
          conversations: c._count.id, estimatedCostUsd, revenue,
          estimatedGrossMargin: revenue - estimatedCostUsd,
        };
      })
      .sort((a, b) => a.estimatedGrossMargin - b.estimatedGrossMargin) // worst margin first -- the ones worth looking at
      .slice(0, 20);
  }

  async getPlatformHealth() {
    const [queueHealth, whatsappQuality, errorRateTrend, costEstimates] = await Promise.all([
      this.getQueueHealth(),
      this.getWhatsAppQualitySummary(),
      this.getErrorRateTrend(30),
      this.getCostEstimatePerTenant(),
    ]);

    return {
      queueHealth,
      whatsappQuality,
      errorRateTrend,
      costEstimatePerTenant: costEstimates,
      // Webhook processing lag and DB/slow-query signals aren't instrumented anywhere in the
      // codebase today (no receipt-vs-processed timestamp is stored, no slow-query log exists) --
      // omitted rather than fabricated, per "never fake historical numbers."
      notInstrumented: ['webhookProcessingLag', 'dbSizeGrowth', 'slowQueryLog'],
    };
  }
}
