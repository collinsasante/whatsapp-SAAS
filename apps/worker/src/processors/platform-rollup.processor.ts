import { Worker, Queue, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const ROLLUP_INTERVAL_MS = 60 * 60 * 1000; // every hour
const BACKFILL_DAYS = 3; // self-healing: re-roll the last N days every run, in case a run was missed
const DEFAULT_GHS_RATE = Number(process.env['GHS_RATE'] ?? '12.5'); // static configured rate, not a live FX feed -- see CurrencyRate.isEstimated

type MrrMovementCategory = 'NEW' | 'EXPANSION' | 'CONTRACTION' | 'CHURNED' | 'RETAINED' | 'NONE';

/**
 * Platform Rollup — runs hourly as a repeatable job. Unlike the per-tenant
 * AnalyticsRollupWorker, this computes cross-tenant platform-admin metrics:
 * a daily USD->GHS rate, a per-tenant-per-day MRR snapshot (+ movement
 * classification vs the prior day), and a platform-wide daily stats row
 * (tenant/subscription lifecycle counts, MRR/ARR, DAU/WAU/MAU from login
 * audit events). Uses UTC calendar days throughout -- this is a platform-wide
 * view, not a per-tenant one, so there's no single "tenant timezone" to bucket by.
 *
 * Idempotent by design (upsert on unique keys), so a missed hour or a re-run
 * never double-counts. See apps/backend/src/platform-admin/utils/{mrr,currency}.util.ts
 * for the backend's copy of the same classification/normalization logic (duplicated,
 * not imported, so this worker package has no compile-time dependency on the backend app).
 */
export class PlatformRollupWorker {
  private worker?: Worker;
  private queue?: Queue;

  constructor(
    private prisma: PrismaClient,
    private connection: { host: string; port: number; password?: string },
  ) {}

  async start() {
    this.queue = new Queue('platform-rollup', { connection: this.connection });

    await this.queue.add(
      'rollup',
      {},
      {
        repeat: { every: ROLLUP_INTERVAL_MS },
        jobId: 'platform-rollup-repeatable',
        removeOnComplete: 5,
        removeOnFail: 5,
      },
    );

    this.worker = new Worker<Record<string, never>>(
      'platform-rollup',
      this.process.bind(this),
      { connection: this.connection, concurrency: 1 },
    );

    this.worker.on('failed', (_job: Job | undefined, err: Error) => {
      console.error('[PlatformRollup] Job failed:', err.message);
    });

    console.log('[PlatformRollup] Worker started — rolling up hourly');
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process() {
    const dates = this.lastNCompleteDates(BACKFILL_DAYS);
    for (const dateStr of dates) {
      try {
        await this.rollupDate(dateStr);
      } catch (err) {
        console.error(`[PlatformRollup] Failed for ${dateStr}:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** Last N UTC calendar dates (YYYY-MM-DD) strictly before today. */
  private lastNCompleteDates(n: number): string[] {
    const now = new Date();
    const dates: string[] = [];
    for (let i = 1; i <= n; i++) {
      const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      dates.push(dt.toISOString().slice(0, 10));
    }
    return dates;
  }

  private async rollupDate(dateStr: string) {
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    const start = date;
    const end = new Date(date.getTime() + 24 * 60 * 60 * 1000);

    await this.rollupCurrencyRate(date);
    const mrrGhs = await this.rollupMrrSnapshots(date);
    await this.rollupPlatformDailyStats(date, start, end, mrrGhs);
  }

  /** Only USD needs a stored rate today (Stripe settles in USD, Paystack settles in GHS natively). */
  private async rollupCurrencyRate(date: Date) {
    await this.prisma.currencyRate.upsert({
      where: { date_currency: { date, currency: 'USD' } },
      create: { date, currency: 'USD', rateToGhs: DEFAULT_GHS_RATE, isEstimated: true },
      update: { rateToGhs: DEFAULT_GHS_RATE, isEstimated: true },
    });
  }

  private normalizeToGhs(amount: number, currency: string, usdRate: number): number {
    if (currency === 'GHS') return amount;
    if (currency === 'USD') return amount * usdRate;
    return amount; // unrecognized currency: pass through rather than silently drop revenue
  }

  private classifyMrrMovement(previousMrr: number, currentMrr: number): MrrMovementCategory {
    if (previousMrr <= 0 && currentMrr <= 0) return 'NONE';
    if (previousMrr <= 0 && currentMrr > 0) return 'NEW';
    if (previousMrr > 0 && currentMrr <= 0) return 'CHURNED';
    if (currentMrr > previousMrr) return 'EXPANSION';
    if (currentMrr < previousMrr) return 'CONTRACTION';
    return 'RETAINED';
  }

  /** Snapshots every tenant's MRR contribution for `date`, classifies movement vs the prior day, and returns the platform-wide MRR total. */
  private async rollupMrrSnapshots(date: Date): Promise<number> {
    const usdRate = DEFAULT_GHS_RATE;

    // PAST_DUE is still "supposed to be paying" -- counted at full expected MRR (a documented assumption).
    const subs = await this.prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
      select: { tenantId: true, cycle: true, plan: { select: { monthlyPrice: true, yearlyPrice: true, currency: true } } },
    });

    const currentByTenant = new Map<string, number>();
    for (const sub of subs) {
      const rawAmount = sub.cycle === 'YEARLY' ? sub.plan.yearlyPrice / 12 : sub.plan.monthlyPrice;
      currentByTenant.set(sub.tenantId, this.normalizeToGhs(rawAmount, sub.plan.currency, usdRate));
    }

    const yesterday = new Date(date.getTime() - 24 * 60 * 60 * 1000);
    const prevSnapshots = await this.prisma.platformTenantMrrSnapshot.findMany({
      where: { date: yesterday },
      select: { tenantId: true, mrrGhs: true },
    });
    const prevByTenant = new Map(prevSnapshots.map((s) => [s.tenantId, s.mrrGhs]));

    // Union so a tenant that churned (had MRR yesterday, has none today) still gets a row.
    const allTenantIds = new Set([...currentByTenant.keys(), ...prevByTenant.keys()]);

    let mrrTotal = 0;
    await Promise.all(
      Array.from(allTenantIds).map(async (tenantId) => {
        const current = currentByTenant.get(tenantId) ?? 0;
        const previous = prevByTenant.get(tenantId) ?? 0;
        const category = this.classifyMrrMovement(previous, current);
        mrrTotal += current;
        await this.prisma.platformTenantMrrSnapshot.upsert({
          where: { tenantId_date: { tenantId, date } },
          create: { tenantId, date, mrrGhs: current, category },
          update: { mrrGhs: current, category },
        });
      }),
    );

    return mrrTotal;
  }

  private async distinctLoginCount(start: Date, end: Date): Promise<number> {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: 'LOGIN', userId: { not: null }, createdAt: { gte: start, lt: end } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.length;
  }

  private async rollupPlatformDailyStats(date: Date, start: Date, end: Date, mrrGhs: number) {
    const [
      totalTenants, activeTenants, newTenants, trialTenants,
      activeSubscriptions, pastDueSubscriptions, churnedTenants,
      trialsConverted, dau, wau, mau,
    ] = await Promise.all([
      this.prisma.tenant.count({ where: { createdAt: { lt: end } } }),
      // Approximation for backfilled days: uses the tenant's CURRENT isActive flag, not
      // a historical point-in-time value (no suspend/reactivate history table exists yet).
      this.prisma.tenant.count({ where: { isActive: true, createdAt: { lt: end } } }),
      this.prisma.tenant.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.subscription.count({ where: { status: 'TRIAL' } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.subscription.count({ where: { status: 'PAST_DUE' } }),
      this.prisma.platformTenantMrrSnapshot.count({ where: { date, category: 'CHURNED' } }),
      // Approximation: a subscription whose trial ended and is now ACTIVE within this
      // window. Doesn't distinguish "converted" from "re-activated after a lapse".
      this.prisma.subscription.count({ where: { status: 'ACTIVE', trialEndsAt: { gte: start, lt: end } } }),
      this.distinctLoginCount(start, end),
      this.distinctLoginCount(new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000), end),
      this.distinctLoginCount(new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000), end),
    ]);

    const arrGhs = mrrGhs * 12;

    await this.prisma.platformDailyStats.upsert({
      where: { date },
      create: {
        date, totalTenants, activeTenants, newTenants, trialTenants,
        activeSubscriptions, pastDueSubscriptions, trialsConverted, churnedTenants,
        mrrGhs, arrGhs, dau, wau, mau,
      },
      update: {
        totalTenants, activeTenants, newTenants, trialTenants,
        activeSubscriptions, pastDueSubscriptions, trialsConverted, churnedTenants,
        mrrGhs, arrGhs, dau, wau, mau,
      },
    });
  }
}
