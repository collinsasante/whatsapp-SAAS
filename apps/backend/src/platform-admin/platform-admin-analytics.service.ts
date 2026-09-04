import { Injectable, NotFoundException } from '@nestjs/common';
import { AiCreditTransactionType, LedgerEntryType, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveDateRange } from '../analytics/analytics.util';

/**
 * Cross-tenant aggregation endpoints for the admin AI/Commerce/Messaging/Payments
 * pages -- split out from PlatformAdminService (already large) rather than added
 * to it. All money/date math follows the same conventions used throughout that
 * file: SQL-side groupBy/_sum (not JS reduction across rows), resolveDateRange
 * for from/to validation, UTC day buckets to match AiExecution/CommerceLedgerEntry/
 * AnalyticsDailyMessageStats's own platform-wide (not tenant-local) semantics.
 */
@Injectable()
export class PlatformAdminAnalyticsService {
  constructor(private prisma: PrismaService) {}

  // ── AI ───────────────────────────────────────────────────────────────────

  async getAiAnalytics(fromStr?: string, toStr?: string) {
    const { from, to } = resolveDateRange(fromStr, toStr, 'UTC');
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const [executions, creditRevenue, byProvider, byModel] = await Promise.all([
      this.prisma.aiExecution.findMany({
        where: { createdAt: { gte: fromDate, lte: toDate } },
        select: { createdAt: true, estCostUsd: true, status: true },
      }),
      this.prisma.creditPurchase.aggregate({
        where: { status: PaymentStatus.SUCCEEDED, createdAt: { gte: fromDate, lte: toDate } },
        _sum: { amount: true },
      }),
      this.prisma.aiExecution.groupBy({
        by: ['provider'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _count: { id: true },
        _sum: { estCostUsd: true },
      }),
      this.prisma.aiExecution.groupBy({
        by: ['provider', 'modelKey'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _count: { id: true },
        _sum: { estCostUsd: true },
      }),
    ]);

    const dailyMap = new Map<string, { calls: number; costUsd: number; failed: number }>();
    for (const e of executions) {
      const day = e.createdAt.toISOString().slice(0, 10);
      const bucket = dailyMap.get(day) ?? { calls: 0, costUsd: 0, failed: 0 };
      bucket.calls++;
      bucket.costUsd += e.estCostUsd ? Number(e.estCostUsd) : 0;
      if (e.status !== 'SUCCESS') bucket.failed++;
      dailyMap.set(day, bucket);
    }
    const daily = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, calls: v.calls, costUsd: Math.round(v.costUsd * 100) / 100, failed: v.failed }));

    const totalCostUsd = executions.reduce((sum, e) => sum + (e.estCostUsd ? Number(e.estCostUsd) : 0), 0);
    const revenueUsd = creditRevenue._sum.amount ?? 0;

    return {
      period: { from, to },
      totals: {
        calls: executions.length,
        costUsd: Math.round(totalCostUsd * 100) / 100,
        revenueUsd: Math.round(revenueUsd * 100) / 100,
        marginUsd: Math.round((revenueUsd - totalCostUsd) * 100) / 100,
      },
      daily,
      byProvider: byProvider.map((r) => ({ provider: r.provider, calls: r._count.id, costUsd: Math.round((r._sum.estCostUsd ? Number(r._sum.estCostUsd) : 0) * 100) / 100 })),
      byModel: byModel.map((r) => ({ provider: r.provider, modelKey: r.modelKey, calls: r._count.id, costUsd: Math.round((r._sum.estCostUsd ? Number(r._sum.estCostUsd) : 0) * 100) / 100 })),
    };
  }

  /** Top-20 tenants by AI credit consumption in the window -- same top-20 pattern as PlatformHealthService.getCostEstimatePerTenant. */
  async getAiUsageTopConsumers(fromStr?: string, toStr?: string) {
    const { from, to } = resolveDateRange(fromStr, toStr, 'UTC');
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const rows = await this.prisma.aiCreditTransaction.groupBy({
      by: ['tenantId'],
      where: { type: AiCreditTransactionType.AI_USAGE, createdAt: { gte: fromDate, lte: toDate } },
      _sum: { credits: true },
      _count: { id: true },
    });
    if (rows.length === 0) return { period: { from, to }, items: [] };

    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true } });
    const nameByTenant = new Map(tenants.map((t) => [t.id, t.name]));

    const items = rows
      .map((r) => ({ tenantId: r.tenantId, tenantName: nameByTenant.get(r.tenantId) ?? 'Unknown', creditsConsumed: -(r._sum.credits ?? 0), aiCalls: r._count.id }))
      .sort((a, b) => b.creditsConsumed - a.creditsConsumed)
      .slice(0, 20);

    return { period: { from, to }, items };
  }

  /** One aggregation query, not N+1 -- balance from Tenant.aiCredits, purchased/consumed/bonus from a single groupBy. */
  async getAiCreditWallets(params: { search?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(params.limit ?? 50, 100);
    const offset = params.offset ?? 0;

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where: params.search ? { name: { contains: params.search, mode: 'insensitive' } } : undefined,
        select: { id: true, name: true, aiCredits: true },
        orderBy: { name: 'asc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.tenant.count({ where: params.search ? { name: { contains: params.search, mode: 'insensitive' } } : undefined }),
    ]);

    const tenantIds = tenants.map((t) => t.id);
    const byType = tenantIds.length
      ? await this.prisma.aiCreditTransaction.groupBy({ by: ['tenantId', 'type'], where: { tenantId: { in: tenantIds } }, _sum: { credits: true } })
      : [];

    const walletByTenant = new Map<string, { purchased: number; bonus: number; consumed: number; refunded: number; adjusted: number }>();
    for (const id of tenantIds) walletByTenant.set(id, { purchased: 0, bonus: 0, consumed: 0, refunded: 0, adjusted: 0 });
    for (const row of byType) {
      const w = walletByTenant.get(row.tenantId);
      if (!w) continue;
      const sum = row._sum.credits ?? 0;
      if (row.type === AiCreditTransactionType.PURCHASE) w.purchased += sum;
      else if (row.type === AiCreditTransactionType.BONUS) w.bonus += sum;
      else if (row.type === AiCreditTransactionType.AI_USAGE) w.consumed += -sum;
      else if (row.type === AiCreditTransactionType.REFUND) w.refunded += sum;
      else if (row.type === AiCreditTransactionType.ADJUSTMENT) w.adjusted += sum;
    }

    return {
      total,
      limit,
      offset,
      items: tenants.map((t) => ({
        tenantId: t.id,
        tenantName: t.name,
        balance: t.aiCredits,
        ...walletByTenant.get(t.id)!,
      })),
    };
  }

  // ── Commerce ─────────────────────────────────────────────────────────────

  async getCommerceAnalytics(fromStr?: string, toStr?: string) {
    const { from, to } = resolveDateRange(fromStr, toStr, 'UTC');
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const [entries, byTenant] = await Promise.all([
      this.prisma.commerceLedgerEntry.findMany({
        where: { createdAt: { gte: fromDate, lte: toDate } },
        select: { createdAt: true, type: true, amountMajorUnits: true },
      }),
      this.prisma.commerceLedgerEntry.groupBy({
        by: ['tenantId', 'type'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _sum: { amountMajorUnits: true },
      }),
    ]);

    const dailyMap = new Map<string, { gmv: number; fees: number; refunds: number }>();
    for (const e of entries) {
      const day = e.createdAt.toISOString().slice(0, 10);
      const bucket = dailyMap.get(day) ?? { gmv: 0, fees: 0, refunds: 0 };
      if (e.type === LedgerEntryType.GMV) bucket.gmv += e.amountMajorUnits;
      else if (e.type === LedgerEntryType.TAKE_RATE) bucket.fees += -e.amountMajorUnits;
      else if (e.type === LedgerEntryType.REFUND_ADJUSTMENT) bucket.refunds += e.amountMajorUnits;
      dailyMap.set(day, bucket);
    }
    const daily = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
      date, gmv: Math.round(v.gmv * 100) / 100, fees: Math.round(v.fees * 100) / 100, refunds: Math.round(v.refunds * 100) / 100,
    }));

    const gmvByTenant = new Map<string, number>();
    for (const row of byTenant) {
      if (row.type !== LedgerEntryType.GMV) continue;
      gmvByTenant.set(row.tenantId, (row._sum.amountMajorUnits ?? 0));
    }
    if (gmvByTenant.size === 0) {
      return { period: { from, to }, totals: { gmv: 0, fees: 0, refunds: 0 }, daily, topTenants: [] };
    }
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...gmvByTenant.keys()] } }, select: { id: true, name: true } });
    const nameByTenant = new Map(tenants.map((t) => [t.id, t.name]));
    const topTenants = [...gmvByTenant.entries()]
      .map(([tenantId, gmv]) => ({ tenantId, tenantName: nameByTenant.get(tenantId) ?? 'Unknown', gmv: Math.round(gmv * 100) / 100 }))
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 20);

    const totals = daily.reduce((acc, d) => ({ gmv: acc.gmv + d.gmv, fees: acc.fees + d.fees, refunds: acc.refunds + d.refunds }), { gmv: 0, fees: 0, refunds: 0 });

    return {
      period: { from, to },
      totals: { gmv: Math.round(totals.gmv * 100) / 100, fees: Math.round(totals.fees * 100) / 100, refunds: Math.round(totals.refunds * 100) / 100 },
      daily,
      topTenants,
    };
  }

  async listOrders(params: { tenantId?: string; status?: string; search?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(params.limit ?? 50, 100);
    const offset = params.offset ?? 0;
    const where = {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.search ? { OR: [{ customerName: { contains: params.search, mode: 'insensitive' as const } }, { customerPhone: { contains: params.search } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { tenant: { select: { id: true, name: true } } },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async getOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true } },
        items: true,
        events: { orderBy: { createdAt: 'desc' } },
        ledgerEntries: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Cross-tenant fee ledger. `duplicateOrders` flags any order with more than
   * one GMV entry -- an explicit check, not just trust in the unique constraint
   * that's supposed to prevent it (@@unique([orderId, type, gatewayEventId]) on
   * CommerceLedgerEntry allows >1 GMV row per order if they arrived under
   * different gatewayEventIds, which would be a real double-charge bug worth
   * surfacing even though the constraint stops the identical-event case).
   */
  async getCommerceFees(fromStr?: string, toStr?: string) {
    const { from, to } = resolveDateRange(fromStr, toStr, 'UTC');
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const [entries, gmvPerOrder] = await Promise.all([
      this.prisma.commerceLedgerEntry.findMany({
        where: { createdAt: { gte: fromDate, lte: toDate } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { tenant: { select: { id: true, name: true } } },
      }),
      this.prisma.commerceLedgerEntry.groupBy({
        by: ['orderId'],
        where: { type: LedgerEntryType.GMV, createdAt: { gte: fromDate, lte: toDate } },
        _count: { id: true },
      }),
    ]);

    const duplicateOrders = gmvPerOrder.filter((r) => r._count.id > 1).map((r) => r.orderId);

    return { period: { from, to }, entries, anomalies: { duplicateGmvOrderIds: duplicateOrders } };
  }

  // ── Messaging ────────────────────────────────────────────────────────────

  /**
   * Cross-tenant sum of AnalyticsDailyMessageStats (same groupBy-and-sum
   * pattern PlatformHealthService.getErrorRateTrend already uses), plus a real
   * per-tenant failure-rate ranking. No per-WhatsApp-number breakdown --
   * AnalyticsDailyMessageStats has no number-level dimension to aggregate from,
   * so that's not built rather than faked.
   */
  async getMessagingAnalytics(fromStr?: string, toStr?: string) {
    const { from, to } = resolveDateRange(fromStr, toStr, 'UTC');
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const [daily, perTenant] = await Promise.all([
      this.prisma.analyticsDailyMessageStats.groupBy({
        by: ['date'],
        where: { date: { gte: fromDate, lte: toDate } },
        _sum: { sentCount: true, deliveredCount: true, readCount: true, failedCount: true, inboundCount: true },
      }),
      this.prisma.analyticsDailyMessageStats.groupBy({
        by: ['tenantId'],
        where: { date: { gte: fromDate, lte: toDate } },
        _sum: { sentCount: true, failedCount: true },
      }),
    ]);

    const dailySorted = daily.sort((a, b) => a.date.getTime() - b.date.getTime()).map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      sent: r._sum.sentCount ?? 0,
      delivered: r._sum.deliveredCount ?? 0,
      read: r._sum.readCount ?? 0,
      failed: r._sum.failedCount ?? 0,
      inbound: r._sum.inboundCount ?? 0,
    }));

    const totals = dailySorted.reduce((acc, d) => ({
      sent: acc.sent + d.sent, delivered: acc.delivered + d.delivered, read: acc.read + d.read, failed: acc.failed + d.failed, inbound: acc.inbound + d.inbound,
    }), { sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0 });

    const candidates = perTenant
      .map((r) => ({ tenantId: r.tenantId, sent: r._sum.sentCount ?? 0, failed: r._sum.failedCount ?? 0 }))
      .filter((r) => r.sent + r.failed >= 10) // ignore near-zero-volume tenants -- their rate is statistical noise
      .map((r) => ({ ...r, errorRatePct: Math.round((r.failed / (r.sent + r.failed)) * 1000) / 10 }))
      .sort((a, b) => b.errorRatePct - a.errorRatePct)
      .slice(0, 20);

    const tenants = candidates.length
      ? await this.prisma.tenant.findMany({ where: { id: { in: candidates.map((c) => c.tenantId) } }, select: { id: true, name: true } })
      : [];
    const nameByTenant = new Map(tenants.map((t) => [t.id, t.name]));
    const topFailingTenants = candidates.map((c) => ({ ...c, tenantName: nameByTenant.get(c.tenantId) ?? 'Unknown' }));

    return { period: { from, to }, totals, daily: dailySorted, topFailingTenants };
  }

  // ── Payments ─────────────────────────────────────────────────────────────

  async listPayments(params: { tenantId?: string; status?: string; gateway?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(params.limit ?? 50, 100);
    const offset = params.offset ?? 0;
    const where = {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.gateway ? { gateway: params.gateway as never } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { tenant: { select: { id: true, name: true } } },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  // ── Audit logs ───────────────────────────────────────────────────────────

  async listAuditLogs(params: { adminId?: string; action?: string; resourceType?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(params.limit ?? 50, 100);
    const offset = params.offset ?? 0;
    const where = {
      ...(params.adminId ? { adminId: params.adminId } : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.resourceType ? { resourceType: params.resourceType } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { admin: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  // ── Global search ────────────────────────────────────────────────────────

  /** A handful of parallel targeted findMany calls, merged and capped -- not a full search-engine build. */
  async search(q: string) {
    const query = q.trim();
    if (query.length < 2) return { tenants: [], users: [], orders: [], payments: [] };

    const [tenants, users, orders, payments] = await Promise.all([
      this.prisma.tenant.findMany({ where: { name: { contains: query, mode: 'insensitive' } }, select: { id: true, name: true }, take: 5 }),
      this.prisma.user.findMany({
        where: { OR: [{ name: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }] },
        select: { id: true, name: true, email: true, tenantId: true },
        take: 5,
      }),
      this.prisma.order.findMany({
        where: { OR: [{ id: query }, { customerName: { contains: query, mode: 'insensitive' } }, { customerPhone: { contains: query } }] },
        select: { id: true, customerName: true, customerPhone: true, tenantId: true, totalMajorUnits: true, currency: true },
        take: 5,
      }),
      this.prisma.payment.findMany({
        where: { OR: [{ gatewayReference: { contains: query } }, { gatewayPaymentId: { contains: query } }] },
        select: { id: true, gatewayReference: true, gatewayPaymentId: true, tenantId: true, amount: true, currency: true },
        take: 5,
      }),
    ]);

    return { tenants, users, orders, payments };
  }
}
