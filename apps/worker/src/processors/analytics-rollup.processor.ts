import { Worker, Queue, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const ROLLUP_INTERVAL_MS = 60 * 60 * 1000; // every hour
const BACKFILL_DAYS = 3; // self-healing: re-roll the last N days every run, in case a run was missed

/**
 * Analytics Rollup — runs hourly as a repeatable job. For every tenant,
 * recomputes daily message/conversation/revenue rollups for the last few
 * days (bucketed in the tenant's own timezone, default Africa/Accra) and
 * upserts them into analytics_daily_*_stats. The analytics API computes
 * "today so far" live and merges it with these rows -- see
 * apps/backend/src/analytics/analytics.service.ts.
 *
 * Idempotent by design (upsert on the tenantId+date unique key), so a
 * missed hour or a re-run never double-counts.
 */
export class AnalyticsRollupWorker {
  private worker?: Worker;
  private queue?: Queue;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  async start() {
    this.queue = new Queue('analytics-rollup', { connection: this.connection });

    await this.queue.add(
      'rollup',
      {},
      {
        repeat: { every: ROLLUP_INTERVAL_MS },
        jobId: 'analytics-rollup-repeatable',
        removeOnComplete: 5,
        removeOnFail: 5,
      },
    );

    this.worker = new Worker<Record<string, never>>(
      'analytics-rollup',
      this.process.bind(this),
      { connection: this.connection, concurrency: 1 },
    );

    this.worker.on('failed', (_job: Job | undefined, err: Error) => {
      console.error('[AnalyticsRollup] Job failed:', err.message);
    });

    console.log('[AnalyticsRollup] Worker started — rolling up hourly');
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process() {
    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, settings: { select: { timezone: true } } },
    });

    for (const tenant of tenants) {
      const timezone = tenant.settings?.timezone ?? 'Africa/Accra';
      try {
        await this.rollupTenant(tenant.id, timezone);
      } catch (err) {
        console.error(`[AnalyticsRollup] Failed for tenant ${tenant.id}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  private async rollupTenant(tenantId: string, timezone: string) {
    const dates = this.lastNCompleteDates(BACKFILL_DAYS, timezone);
    for (const dateStr of dates) {
      const { start, end } = this.dayBoundaries(dateStr, timezone);
      await Promise.all([
        this.rollupMessages(tenantId, dateStr, start, end),
        this.rollupConversations(tenantId, dateStr, start, end),
        this.rollupRevenue(tenantId, dateStr, start, end),
      ]);
    }
  }

  /** Last N calendar dates (YYYY-MM-DD, in `timezone`) strictly before today -- "today" is always computed live. */
  private lastNCompleteDates(n: number, timezone: string): string[] {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [y, m, d] = todayStr.split('-').map(Number);
    const dates: string[] = [];
    for (let i = 1; i <= n; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d - i));
      dates.push(dt.toISOString().slice(0, 10));
    }
    return dates;
  }

  /** [start, end) UTC instants for one calendar day in `timezone` -- duplicated (not imported) so the worker has no compile-time dependency on the backend app. */
  private dayBoundaries(dateStr: string, timezone: string): { start: Date; end: Date } {
    const [y, m, d] = dateStr.split('-').map(Number);
    const utcGuess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(utcGuess);
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
    const hour = map.hour === '24' ? 0 : Number(map.hour);
    const asUtcIfLocalWereUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
    const offsetMin = Math.round((asUtcIfLocalWereUtc - utcGuess.getTime()) / 60_000);
    const start = new Date(utcGuess.getTime() - offsetMin * 60_000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  private async rollupMessages(tenantId: string, dateStr: string, start: Date, end: Date) {
    const [sentCount, deliveredCount, readCount, failedCount, inboundCount, outboundCount] = await Promise.all([
      this.prisma.message.count({ where: { tenantId, sentAt: { gte: start, lt: end } } }),
      this.prisma.message.count({ where: { tenantId, deliveredAt: { gte: start, lt: end } } }),
      this.prisma.message.count({ where: { tenantId, readAt: { gte: start, lt: end } } }),
      this.prisma.message.count({ where: { tenantId, failedAt: { gte: start, lt: end } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'INBOUND', createdAt: { gte: start, lt: end } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'OUTBOUND', createdAt: { gte: start, lt: end } } }),
    ]);

    const date = new Date(`${dateStr}T00:00:00.000Z`);
    await this.prisma.analyticsDailyMessageStats.upsert({
      where: { tenantId_date: { tenantId, date } },
      create: { tenantId, date, sentCount, deliveredCount, readCount, failedCount, inboundCount, outboundCount },
      update: { sentCount, deliveredCount, readCount, failedCount, inboundCount, outboundCount },
    });
  }

  private async rollupConversations(tenantId: string, dateStr: string, start: Date, end: Date) {
    // New vs returning: a conversation created in this window counts as "new" if the
    // contact had no earlier conversation, "returning" otherwise. A correlated subquery
    // keeps this to one indexed pass rather than N+1 (bounded by tenantId+contactId index).
    const rows = await this.prisma.$queryRaw<Array<{ prior_count: bigint }>>`
      SELECT (
        SELECT COUNT(*)::bigint FROM "conversations" c2
        WHERE c2.tenant_id = c.tenant_id AND c2.contact_id = c.contact_id AND c2.created_at < c.created_at
      ) AS prior_count
      FROM "conversations" c
      WHERE c.tenant_id = ${tenantId} AND c.created_at >= ${start} AND c.created_at < ${end}
    `;
    let newConversations = 0;
    let returningConversations = 0;
    for (const row of rows) {
      if (row.prior_count === BigInt(0)) newConversations++;
      else returningConversations++;
    }

    const resolvedCount = await this.prisma.conversation.count({ where: { tenantId, resolvedAt: { gte: start, lt: end } } });

    const date = new Date(`${dateStr}T00:00:00.000Z`);
    const openedCount = newConversations + returningConversations;
    await this.prisma.analyticsDailyConversationStats.upsert({
      where: { tenantId_date: { tenantId, date } },
      create: { tenantId, date, newConversations, returningConversations, openedCount, resolvedCount },
      update: { newConversations, returningConversations, openedCount, resolvedCount },
    });
  }

  private async rollupRevenue(tenantId: string, dateStr: string, start: Date, end: Date) {
    const grouped = await this.prisma.payment.groupBy({
      by: ['gateway', 'status'],
      where: { tenantId, createdAt: { gte: start, lt: end } },
      _count: { id: true },
      _sum: { amount: true },
    });

    const byGateway = new Map<string, { successCount: number; failedCount: number; amount: number }>();
    for (const row of grouped) {
      const entry = byGateway.get(row.gateway) ?? { successCount: 0, failedCount: 0, amount: 0 };
      if (row.status === 'SUCCEEDED') {
        entry.successCount += row._count.id;
        entry.amount += row._sum.amount ?? 0;
      } else if (row.status === 'FAILED') {
        entry.failedCount += row._count.id;
      }
      byGateway.set(row.gateway, entry);
    }

    const date = new Date(`${dateStr}T00:00:00.000Z`);
    await Promise.all(
      Array.from(byGateway.entries()).map(([gateway, stats]) =>
        this.prisma.analyticsDailyRevenueStats.upsert({
          where: { tenantId_date_gateway: { tenantId, date, gateway: gateway as never } },
          create: { tenantId, date, gateway: gateway as never, ...stats },
          update: stats,
        }),
      ),
    );
  }
}
