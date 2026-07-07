import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto, TenantsQueryDto, UpdatePlanDto, UpdateWorkspaceDto } from './dto/platform-admin.dto';
import { resolveDateRange, previousPeriod, percentChange } from '../analytics/analytics.util';
import { computeArpu, computeLogoChurnRate, computeNetRevenueRetention, computeTrialConversionRate } from './utils/overview.util';
import { computeHealthScore, isChurnRisk } from './utils/health-score.util';
import { deriveLifecycleStage } from './utils/lifecycle.util';

const MRR_MOVEMENT_CATEGORIES = ['NEW', 'EXPANSION', 'CONTRACTION', 'CHURNED'] as const;

@Injectable()
export class PlatformAdminService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalTenants,
      activeSubs,
      trialSubs,
      totalUsers,
      totalMessages,
      pendingInvoices,
      pendingCredits,
      revenueResult,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.subscription.count({ where: { status: 'TRIAL' } }),
      this.prisma.user.count(),
      this.prisma.message.count(),
      this.prisma.invoice.count({ where: { status: 'OPEN' } }),
      this.prisma.creditPurchase.count({ where: { status: 'PENDING' } }),
      this.prisma.invoice.aggregate({
        _sum: { total: true },
        where: { status: 'PAID', paidAt: { gte: monthStart } },
      }),
    ]);

    return {
      totalTenants,
      activeSubs,
      trialSubs,
      totalUsers,
      totalMessages,
      pendingInvoices,
      pendingCredits,
      monthlyRevenue: revenueResult._sum.total ?? 0,
    };
  }

  /**
   * "Am I growing?" overview strip. `from`/`to` default to the trailing 30 days
   * (UTC calendar days -- this is a platform-wide view, no single tenant
   * timezone applies). MRR/ARR/active-paying/trials-in-progress are read from
   * the most recent PlatformDailyStats row at or before `to` (the rollup runs
   * hourly, so "today" may not have a row yet -- falls back to 0 rather than
   * erroring if the platform-rollup worker has never run).
   */
  async getOverview(fromStr?: string, toStr?: string) {
    const { from, to } = resolveDateRange(fromStr, toStr, 'UTC');
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    const { from: prevFrom, to: prevTo } = previousPeriod(from, to);
    const prevToDate = new Date(`${prevTo}T00:00:00.000Z`);

    const [latestStats, previousStats, trendRows, movementRows, startSnapshots] = await Promise.all([
      this.prisma.platformDailyStats.findFirst({ where: { date: { lte: toDate } }, orderBy: { date: 'desc' } }),
      this.prisma.platformDailyStats.findFirst({ where: { date: { lte: prevToDate } }, orderBy: { date: 'desc' } }),
      this.prisma.platformDailyStats.findMany({
        where: { date: { gte: new Date(toDate.getTime() - 365 * 24 * 60 * 60 * 1000), lte: toDate } },
        orderBy: { date: 'asc' },
        select: { date: true, mrrGhs: true },
      }),
      this.prisma.platformTenantMrrSnapshot.groupBy({
        by: ['category'],
        where: { date: { gte: fromDate, lte: toDate } },
        _count: { tenantId: true },
        _sum: { mrrGhs: true },
      }),
      this.prisma.platformTenantMrrSnapshot.findMany({
        where: { date: fromDate, mrrGhs: { gt: 0 } },
        select: { tenantId: true, mrrGhs: true },
      }),
    ]);

    const mrr = latestStats?.mrrGhs ?? 0;
    const activePayingTenants = latestStats?.activeSubscriptions ?? 0;
    const trialsInProgress = latestStats?.trialTenants ?? 0;

    type MovementBucket = { count: number; amountGhs: number; tenants: { tenantId: string; tenantName: string; mrrGhs: number; date: string }[] };
    const mrrMovement = Object.fromEntries(
      MRR_MOVEMENT_CATEGORIES.map((cat) => [cat, { count: 0, amountGhs: 0, tenants: [] as MovementBucket['tenants'] }]),
    ) as unknown as Record<(typeof MRR_MOVEMENT_CATEGORIES)[number], MovementBucket>;
    for (const row of movementRows) {
      if ((MRR_MOVEMENT_CATEGORIES as readonly string[]).includes(row.category)) {
        const cat = row.category as (typeof MRR_MOVEMENT_CATEGORIES)[number];
        mrrMovement[cat].count = row._count.tenantId;
        mrrMovement[cat].amountGhs = row._sum.mrrGhs ?? 0;
      }
    }

    const periodStatsForConversion = await this.prisma.platformDailyStats.aggregate({
      where: { date: { gte: fromDate, lte: toDate } },
      _sum: { trialsConverted: true },
    });

    const cohortTenantIds = startSnapshots.map((s) => s.tenantId);
    const startCohortMrr = startSnapshots.reduce((sum, s) => sum + s.mrrGhs, 0);
    const endSnapshotsForCohort = cohortTenantIds.length
      ? await this.prisma.platformTenantMrrSnapshot.findMany({
          where: { date: toDate, tenantId: { in: cohortTenantIds } },
          select: { mrrGhs: true },
        })
      : [];
    const endCohortMrr = endSnapshotsForCohort.reduce((sum, s) => sum + s.mrrGhs, 0);

    // Sample of the tenants behind each movement number, so nothing is a dead-end in the UI --
    // capped at 10 per category, most-recent movement first.
    const movementSamples = await Promise.all(
      MRR_MOVEMENT_CATEGORIES.map(async (category) => {
        const snapshots = await this.prisma.platformTenantMrrSnapshot.findMany({
          where: { category, date: { gte: fromDate, lte: toDate } },
          orderBy: { date: 'desc' },
          take: 10,
          select: { tenantId: true, mrrGhs: true, date: true, tenant: { select: { name: true } } },
        });
        return [category, snapshots.map((s) => ({ tenantId: s.tenantId, tenantName: s.tenant.name, mrrGhs: s.mrrGhs, date: s.date.toISOString().slice(0, 10) }))] as const;
      }),
    );
    for (const [category, sample] of movementSamples) {
      mrrMovement[category].tenants = sample;
    }

    return {
      period: { from, to },
      mrr: {
        amountGhs: mrr,
        changePct: percentChange(mrr, previousStats?.mrrGhs ?? 0),
        trend: trendRows.map((r) => ({ date: r.date.toISOString().slice(0, 10), amountGhs: r.mrrGhs })),
      },
      arrGhs: latestStats?.arrGhs ?? 0,
      activePayingTenants,
      trialsInProgress,
      trialToPaidConversionRate: computeTrialConversionRate(periodStatsForConversion._sum.trialsConverted ?? 0, trialsInProgress),
      netRevenueRetention: computeNetRevenueRetention(startCohortMrr, endCohortMrr),
      logoChurnRate: computeLogoChurnRate(mrrMovement.CHURNED.count, cohortTenantIds.length),
      arpuGhs: computeArpu(mrr, activePayingTenants),
      mrrMovement,
    };
  }

  /**
   * The tenant table. Health score, churn-risk, and the "high value" filter are
   * all computed values (not stored columns), so -- given the expected scale of
   * a small/medium multi-tenant SaaS (tens to low hundreds of tenants, not
   * millions) -- this fetches the full search-matched candidate set once,
   * computes everything in application code, then filters/sorts/paginates in
   * memory. That's the right tradeoff at this scale; if the tenant count ever
   * grows enough to make that fetch itself slow, the computed fields would need
   * to move into the daily rollup instead.
   */
  async getTenantsTable(query: TenantsQueryDto) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const search = query.search;

    const where = search
      ? { OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { billingEmail: { contains: search, mode: 'insensitive' as const } },
          { users: { some: { email: { contains: search, mode: 'insensitive' as const } } } },
        ] }
      : {};

    const tenants = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, isActive: true, billingEmail: true, createdAt: true, country: true,
        subscription: {
          select: {
            status: true, cycle: true, trialEndsAt: true,
            plan: { select: { name: true, monthlyPrice: true, yearlyPrice: true, currency: true } },
          },
        },
        users: { where: { isActive: true }, select: { id: true, lastLoginAt: true } },
      },
    });

    const tenantIds = tenants.map((t) => t.id);
    const now = new Date();
    const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [messagesLast30, messagesPrior30, broadcastsThisMonth, conversationsThisMonth, latestPayments, latestRate] = await Promise.all([
      this.prisma.message.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, createdAt: { gte: thirtyDaysAgo } }, _count: { id: true } }),
      this.prisma.message.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }, _count: { id: true } }),
      this.prisma.campaign.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, createdAt: { gte: startOfThisMonth } }, _count: { id: true } }),
      this.prisma.conversation.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, createdAt: { gte: startOfThisMonth } }, _count: { id: true } }),
      this.prisma.payment.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { createdAt: 'desc' }, distinct: ['tenantId'], select: { tenantId: true, status: true, gateway: true, createdAt: true } }),
      this.prisma.currencyRate.findFirst({ where: { currency: 'USD' }, orderBy: { date: 'desc' } }),
    ]);

    const messagesLast30ByTenant = new Map(messagesLast30.map((r) => [r.tenantId, r._count.id]));
    const messagesPrior30ByTenant = new Map(messagesPrior30.map((r) => [r.tenantId, r._count.id]));
    const broadcastsByTenant = new Map(broadcastsThisMonth.map((r) => [r.tenantId, r._count.id]));
    const conversationsByTenant = new Map(conversationsThisMonth.map((r) => [r.tenantId, r._count.id]));
    const lastPaymentByTenant = new Map(latestPayments.map((p) => [p.tenantId, p]));
    const usdRate = latestRate?.rateToGhs ?? Number(process.env['GHS_RATE'] ?? '12.5');

    const rows = tenants.map((t) => {
      const sub = t.subscription;
      const messagesLast30Days = messagesLast30ByTenant.get(t.id) ?? 0;
      const messagesPrior30Days = messagesPrior30ByTenant.get(t.id) ?? 0;
      const lastLoginAt = t.users.reduce<Date | null>((latest, u) => {
        if (!u.lastLoginAt) return latest;
        return !latest || u.lastLoginAt > latest ? u.lastLoginAt : latest;
      }, null);
      const lastPayment = lastPaymentByTenant.get(t.id) ?? null;

      const mrrGhs = sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')
        ? this.normalizePlanPriceToGhs(sub.cycle === 'YEARLY' ? sub.plan.yearlyPrice / 12 : sub.plan.monthlyPrice, sub.plan.currency, usdRate)
        : 0;

      const { score: healthScore, breakdown: healthBreakdown } = computeHealthScore({
        loggedInLast7Days: !!lastLoginAt && lastLoginAt >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        messagesLast30Days,
        sentBroadcastLast30Days: (broadcastsByTenant.get(t.id) ?? 0) > 0,
        teammateCount: t.users.length,
        subscriptionStatus: sub?.status ?? null,
      });

      const activityDropPct = messagesPrior30Days > 0
        ? Math.round(((messagesPrior30Days - messagesLast30Days) / messagesPrior30Days) * 1000) / 10
        : null;
      const churnRisk = isChurnRisk({
        pastDue: sub?.status === 'PAST_DUE',
        activityDropPct,
        zeroActivityLast14Days: messagesLast30Days === 0 && (!lastLoginAt || lastLoginAt < fourteenDaysAgo),
      });

      const status = !t.isActive ? 'suspended'
        : !sub ? 'no_subscription'
        : sub.status === 'CANCELED' || sub.status === 'EXPIRED' ? 'churned'
        : sub.status.toLowerCase();

      return {
        id: t.id, name: t.name, status, isActive: t.isActive,
        createdAt: t.createdAt, country: t.country, billingEmail: t.billingEmail,
        plan: sub?.plan.name ?? null, trialEndsAt: sub?.trialEndsAt ?? null,
        mrrGhs, teammateCount: t.users.length,
        lastPayment: lastPayment ? { status: lastPayment.status, gateway: lastPayment.gateway, createdAt: lastPayment.createdAt } : null,
        healthScore, healthBreakdown, churnRisk,
        usage: {
          conversationsThisMonth: conversationsByTenant.get(t.id) ?? 0,
          messagesLast30Days,
          broadcastsThisMonth: broadcastsByTenant.get(t.id) ?? 0,
        },
      };
    });

    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const highValueThreshold = this.computeTopPercentileMrr(rows.map((r) => r.mrrGhs), 0.1);

    let filtered = rows;
    switch (query.filter) {
      case 'churn_risk': filtered = rows.filter((r) => r.churnRisk); break;
      case 'trial_ending_7d': filtered = rows.filter((r) => r.status === 'trial' && r.trialEndsAt && r.trialEndsAt <= sevenDaysFromNow && r.trialEndsAt >= now); break;
      case 'high_value': filtered = rows.filter((r) => r.mrrGhs >= highValueThreshold && r.mrrGhs > 0); break;
      case 'signed_up_this_month': filtered = rows.filter((r) => r.createdAt >= startOfThisMonth); break;
      case 'past_due': filtered = rows.filter((r) => r.status === 'past_due'); break;
      default: break;
    }

    const sortKey = query.sort ?? 'createdAt';
    const order = query.order ?? 'desc';
    const sorted = [...filtered].sort((a, b) => {
      const av = sortKey === 'name' ? a.name : sortKey === 'mrr' ? a.mrrGhs : sortKey === 'healthScore' ? a.healthScore : a.createdAt.getTime();
      const bv = sortKey === 'name' ? b.name : sortKey === 'mrr' ? b.mrrGhs : sortKey === 'healthScore' ? b.healthScore : b.createdAt.getTime();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return order === 'asc' ? cmp : -cmp;
    });

    return { tenants: sorted.slice(offset, offset + limit), total: sorted.length, limit, offset };
  }

  private normalizePlanPriceToGhs(amount: number, currency: string, usdRate: number): number {
    if (currency === 'GHS') return amount;
    if (currency === 'USD') return amount * usdRate;
    return amount;
  }

  /** Returns the MRR value at the given top percentile (e.g. 0.1 = top 10%) among tenants with any MRR at all. */
  private computeTopPercentileMrr(mrrValues: number[], topFraction: number): number {
    const paying = mrrValues.filter((v) => v > 0).sort((a, b) => b - a);
    if (paying.length === 0) return Infinity;
    const cutoffIndex = Math.max(0, Math.ceil(paying.length * topFraction) - 1);
    return paying[cutoffIndex]!;
  }

  /**
   * The tenant detail drill-down -- the platform owner's prep screen before a
   * customer call. Health score / churn-risk are computed live (current
   * snapshot only); there's no per-tenant daily history table for those yet,
   * so rather than fake a trend, the message/conversation volume charts stand
   * in as the closest real proxy for "how has this tenant's health moved."
   */
  async getWorkspace(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, conversations: true, messages: true, contacts: true } },
        subscription: { include: { plan: true } },
        whatsappNumbers: {
          where: { isActive: true },
          select: { id: true, label: true, phoneNumberId: true, qualityRating: true, messagingLimitTier: true, qualitySyncedAt: true },
        },
        users: { where: { isActive: true }, select: { id: true, name: true, email: true, role: true, lastLoginAt: true } },
        invoices: {
          orderBy: { createdAt: 'desc' }, take: 10,
          select: { id: true, invoiceNumber: true, status: true, total: true, currency: true, createdAt: true, paidAt: true },
        },
        creditPurchases: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!tenant) throw new NotFoundException('Workspace not found');

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      payments, auditLog, messageTrend, conversationTrend, recentCampaigns,
      approvedTemplateCount, everSucceededPayment, resolvedConversationCount,
      messagesLast30, messagesPrior30,
    ] = await Promise.all([
      this.prisma.payment.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.platformAuditLog.findMany({
        where: { resourceType: 'Tenant', resourceId: id },
        orderBy: { createdAt: 'desc' }, take: 20,
        include: { admin: { select: { name: true, email: true } } },
      }),
      this.prisma.analyticsDailyMessageStats.findMany({ where: { tenantId: id, date: { gte: ninetyDaysAgo } }, orderBy: { date: 'asc' } }),
      this.prisma.analyticsDailyConversationStats.findMany({ where: { tenantId: id, date: { gte: ninetyDaysAgo } }, orderBy: { date: 'asc' } }),
      this.prisma.campaign.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, name: true, status: true, totalRecipients: true, sentCount: true, createdAt: true } }),
      this.prisma.template.count({ where: { tenantId: id, status: 'APPROVED' } }),
      this.prisma.payment.count({ where: { tenantId: id, status: 'SUCCEEDED' } }),
      this.prisma.conversation.count({ where: { tenantId: id, resolvedAt: { not: null } } }),
      this.prisma.message.count({ where: { tenantId: id, createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.message.count({ where: { tenantId: id, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
    ]);

    const lastLoginAt = tenant.users.reduce<Date | null>((latest, u) => {
      if (!u.lastLoginAt) return latest;
      return !latest || u.lastLoginAt > latest ? u.lastLoginAt : latest;
    }, null);

    const { score: healthScore, breakdown: healthBreakdown } = computeHealthScore({
      loggedInLast7Days: !!lastLoginAt && lastLoginAt >= sevenDaysAgo,
      messagesLast30Days: messagesLast30,
      sentBroadcastLast30Days: recentCampaigns.some((c) => c.createdAt >= thirtyDaysAgo),
      teammateCount: tenant.users.length,
      subscriptionStatus: tenant.subscription?.status ?? null,
    });

    const activityDropPct = messagesPrior30 > 0 ? Math.round(((messagesPrior30 - messagesLast30) / messagesPrior30) * 1000) / 10 : null;
    const churnRisk = isChurnRisk({
      pastDue: tenant.subscription?.status === 'PAST_DUE',
      activityDropPct,
      zeroActivityLast14Days: messagesLast30 === 0 && (!lastLoginAt || lastLoginAt < fourteenDaysAgo),
    });

    const lifecycleStage = deriveLifecycleStage({
      hasWhatsappNumber: tenant.whatsappNumbers.length > 0,
      hasApprovedTemplate: approvedTemplateCount > 0,
      hasFirstEngagement: recentCampaigns.length > 0 || resolvedConversationCount > 0,
      hasInvitedTeammate: tenant.users.length > 1,
      everConvertedToPaid: everSucceededPayment > 0,
      activeLast7Days: !!lastLoginAt && lastLoginAt >= sevenDaysAgo,
    });

    return {
      ...tenant,
      payments,
      auditLog,
      usage: {
        messageTrend: messageTrend.map((r) => ({ date: r.date.toISOString().slice(0, 10), sent: r.sentCount, received: r.inboundCount })),
        conversationTrend: conversationTrend.map((r) => ({ date: r.date.toISOString().slice(0, 10), opened: r.openedCount, resolved: r.resolvedCount })),
      },
      recentCampaigns,
      healthScore, healthBreakdown, churnRisk, lifecycleStage,
    };
  }

  async suspendWorkspace(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return this.prisma.tenant.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, name: true, isActive: true },
    });
  }

  async activateWorkspace(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return this.prisma.tenant.update({
      where: { id },
      data: { isActive: true },
      select: { id: true, name: true, isActive: true },
    });
  }

  async getAllInvoices(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true } } },
      }),
      this.prisma.invoice.count(),
    ]);
    return { invoices, total, page, limit };
  }

  async updateWorkspace(id: string, data: UpdateWorkspaceDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return this.prisma.tenant.update({
      where: { id },
      data: { ...(data.name && { name: data.name }), ...(data.billingEmail !== undefined && { billingEmail: data.billingEmail }) },
      select: { id: true, name: true, billingEmail: true },
    });
  }

  async getPlans() {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async createPlan(data: CreatePlanDto) {
    return this.prisma.plan.create({ data: { ...data, features: data.features ?? [] } as never });
  }

  async updatePlan(id: string, data: UpdatePlanDto) {
    return this.prisma.plan.update({ where: { id }, data });
  }

  async getWorkspaceTemplates(tenantId: string) {
    return this.prisma.template.findMany({
      where: { tenantId },
      select: { id: true, name: true, language: true, category: true, status: true, components: true },
      orderBy: { name: 'asc' },
    });
  }

  async getUsers(page = 1, limit = 30, search?: string) {
    const skip = (page - 1) * limit;
    const where = search
      ? { OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ] }
      : {};
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, name: true, role: true, isActive: true, emailVerified: true, createdAt: true, lastLoginAt: true,
          tenant: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, total, page, limit };
  }

  async toggleUserActive(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
      select: { id: true, isActive: true },
    });
  }

  async forceSubscription(tenantId: string, planSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');

    const plan = await this.prisma.plan.findUnique({ where: { slug: planSlug } });
    if (!plan) throw new NotFoundException(`Plan "${planSlug}" not found`);

    const now = new Date();
    const periodEnd = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());

    await this.prisma.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId, planId: plan.id,
        status: 'ACTIVE', cycle: 'YEARLY',
        currentPeriodStart: now, currentPeriodEnd: periodEnd,
      },
      update: {
        planId: plan.id, status: 'ACTIVE', cycle: 'YEARLY',
        currentPeriodStart: now, currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false, canceledAt: null,
      },
    });

    return { success: true, tenantId, plan: plan.name, periodEnd };
  }
}
