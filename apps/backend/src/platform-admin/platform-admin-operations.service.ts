import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveDateRange, previousPeriod } from '../analytics/analytics.util';
import { buildAttention } from './utils/attention.util';

const DAY_MS = 86_400_000;

/** Read-only summaries for the platform overview and support screens. Nothing here writes. */
@Injectable()
export class PlatformAdminOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Conditions the platform can detect itself, each with a link to where it is handled. */
  async getAttention() {
    const now = new Date();
    const day = new Date(now.getTime() - DAY_MS);
    const week = new Date(now.getTime() - 7 * DAY_MS);

    const [
      pastDue, trialsEnding, failedPayments, criticalErrors, openErrors, failedWebhooks, redNumbers, outOfCredits, failedLogins,
    ] = await Promise.all([
      this.prisma.subscription.count({ where: { status: 'PAST_DUE', tenant: { isActive: true } } }),
      this.prisma.subscription.count({ where: { status: 'TRIAL', trialEndsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) }, tenant: { isActive: true } } }),
      this.prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: week } } }),
      this.prisma.errorLog.count({ where: { status: 'OPEN', severity: 'CRITICAL' } }),
      this.prisma.errorLog.count({ where: { status: 'OPEN', severity: 'ERROR', lastSeenAt: { gte: day } } }),
      this.prisma.webhookEvent.count({ where: { status: 'FAILED', createdAt: { gte: day } } }),
      this.prisma.whatsAppNumber.count({ where: { isActive: true, qualityRating: 'RED', tenant: { isActive: true } } }),
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM tenants t
        WHERE t.is_active AND t.ai_credits <= 0
          AND EXISTS (SELECT 1 FROM ai_interaction_logs l WHERE l.tenant_id = t.id AND l.created_at >= ${new Date(now.getTime() - 14 * DAY_MS)})
      `,
      this.prisma.platformAuditLog.count({ where: { action: 'auth.login_failed', createdAt: { gte: day } } }),
    ]);

    const { items, checks } = buildAttention({
      pastDueSubscriptions: pastDue, trialsEndingIn7Days: trialsEnding, failedPayments7d: failedPayments,
      openCriticalErrors: criticalErrors, openErrors24h: openErrors, failedWebhooks24h: failedWebhooks,
      whatsappNumbersRed: redNumbers, tenantsOutOfAiCredits: Number(outOfCredits[0]?.n ?? 0), failedAdminLogins24h: failedLogins,
    });

    return {
      checkedAt: now.toISOString(),
      items,
      checks,
      // Things this summary does not look at, so a quiet list is not read as a clean bill of health.
      notChecked: ['Queue depth and worker health (see System Health)', 'Tenant-level integration disconnects (see Messaging)'],
    };
  }

  /**
   * Daily platform growth from the hourly rollup table, plus new users counted live from the users table. If the
   * rollup has not run recently the result says so, instead of presenting stale rows as current.
   */
  async getGrowth(fromStr?: string, toStr?: string) {
    const { from, to } = resolveDateRange(fromStr, toStr, 'UTC');
    const prev = previousPeriod(from, to);
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    const rangeEnd = new Date(toDate.getTime() + DAY_MS);

    const [rows, previousRows, latest, newUsers] = await Promise.all([
      this.prisma.platformDailyStats.findMany({ where: { date: { gte: fromDate, lte: toDate } }, orderBy: { date: 'asc' } }),
      this.prisma.platformDailyStats.aggregate({
        where: { date: { gte: new Date(`${prev.from}T00:00:00.000Z`), lte: new Date(`${prev.to}T00:00:00.000Z`) } },
        _sum: { newTenants: true, churnedTenants: true },
        _count: { _all: true },
      }),
      this.prisma.platformDailyStats.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
      this.prisma.$queryRaw<Array<{ day: string; n: number }>>`
        SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM users
        WHERE created_at >= ${fromDate} AND created_at < ${rangeEnd} GROUP BY 1
      `,
    ]);

    const usersByDay = new Map(newUsers.map((r) => [r.day, Number(r.n)]));
    const latestDate = latest?.date.toISOString().slice(0, 10) ?? null;
    const stale = !latestDate || toDate.getTime() - new Date(`${latestDate}T00:00:00.000Z`).getTime() > 2 * DAY_MS;

    return {
      period: { from, to },
      previousPeriod: prev,
      series: rows.map((r) => {
        const date = r.date.toISOString().slice(0, 10);
        return {
          date, totalTenants: r.totalTenants, newTenants: r.newTenants, activeSubscriptions: r.activeSubscriptions,
          trialTenants: r.trialTenants, pastDueSubscriptions: r.pastDueSubscriptions, churnedTenants: r.churnedTenants,
          mrrGhs: r.mrrGhs, dau: r.dau, mau: r.mau, newUsers: usersByDay.get(date) ?? 0,
        };
      }),
      totals: {
        newTenants: rows.reduce((s, r) => s + r.newTenants, 0),
        previousNewTenants: previousRows._count._all > 0 ? previousRows._sum.newTenants ?? 0 : null,
        newUsers: [...usersByDay.values()].reduce((s, n) => s + n, 0),
      },
      rollup: { latestDate, stale, daysWithData: rows.length },
    };
  }

  /** Everything support needs about one account. Never includes the password hash or any token. */
  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, name: true, role: true, isActive: true, emailVerified: true, isAiAgent: true,
        createdAt: true, lastLoginAt: true,
        tenant: {
          select: { id: true, name: true, isActive: true, subscription: { select: { status: true, trialEndsAt: true, plan: { select: { name: true } } } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [memberships, audit] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'asc' },
        select: { role: true, status: true, joinedAt: true, workspace: { select: { id: true, name: true, isActive: true } } },
      }),
      this.prisma.platformAuditLog.findMany({
        where: { resourceType: 'User', resourceId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { admin: { select: { name: true, email: true } } },
      }),
    ]);

    return { ...user, memberships, audit };
  }
}
