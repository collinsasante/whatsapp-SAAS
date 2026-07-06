import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, UserRole } from '@whatsapp-platform/shared-types';
import { getTenantDateRangeBoundaries, getTenantDayBoundaries, enumerateTenantDates, toTenantDateString } from '../common/utils/timezone.util';
import { resolveDateRange, previousPeriod, percentChange } from './analytics.util';
import { DateRangeQueryDto, ConversationsQueryDto, CampaignsQueryDto } from './dto/analytics.dto';
import { mapWhatsAppErrorCode, FAILURE_CATEGORY_LABELS } from '../common/utils/whatsapp-error.util';

function isAdminRole(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

interface ConversationCounts {
  total: number;
  newConversations: number;
  returningConversations: number;
}

interface MessageCounts {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getTenantTimezone(tenantId: string): Promise<string> {
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    return settings?.timezone ?? 'Africa/Accra';
  }

  // ─── Overview ────────────────────────────────────────────────────────────

  async getOverview(tenantId: string, requester: JwtPayload, query: DateRangeQueryDto) {
    const timezone = await this.getTenantTimezone(tenantId);
    const { from, to } = resolveDateRange(query.from, query.to, timezone);
    const admin = isAdminRole(requester.role);
    const agentScopeId = admin ? undefined : requester.sub;

    const { start, end } = getTenantDateRangeBoundaries(from, to, timezone);
    const prev = previousPeriod(from, to);
    const prevBoundaries = getTenantDateRangeBoundaries(prev.from, prev.to, timezone);

    const [current, previous, messages, medianFirstResponseSeconds, revenue] = await Promise.all([
      this.getConversationCounts(tenantId, start, end, agentScopeId),
      this.getConversationCounts(tenantId, prevBoundaries.start, prevBoundaries.end, agentScopeId),
      this.getMessageCountsForRange(tenantId, from, to, timezone),
      this.getMedianFirstResponseSeconds(tenantId, start, end, agentScopeId),
      admin ? this.getRevenueForRange(tenantId, from, to, timezone) : Promise.resolve(null),
    ]);

    const deliveryRate = messages.sent > 0 ? round1(messages.delivered / messages.sent) : 0;
    const readRate = messages.delivered > 0 ? round1(messages.read / messages.delivered) : 0;
    const replyRate = messages.sent > 0 ? round1(messages.replied / messages.sent) : 0;

    return {
      from, to,
      scope: admin ? 'tenant' as const : 'agent' as const,
      conversations: {
        total: current.total,
        new: current.newConversations,
        returning: current.returningConversations,
        changePct: percentChange(current.total, previous.total),
      },
      messages: { ...messages, deliveryRate, readRate, replyRate },
      medianFirstResponseSeconds,
      revenue,
    };
  }

  // ─── Conversations ───────────────────────────────────────────────────────

  async getConversations(tenantId: string, requester: JwtPayload, query: ConversationsQueryDto) {
    const timezone = await this.getTenantTimezone(tenantId);
    const { from, to } = resolveDateRange(query.from, query.to, timezone);
    const admin = isAdminRole(requester.role);
    const agentScopeId = admin ? undefined : requester.sub;
    const { start, end } = getTenantDateRangeBoundaries(from, to, timezone);

    const rangeDays = enumerateTenantDates(from, to).length;
    const granularity = query.granularity === 'hour' && rangeDays <= 3 ? 'hour' : 'day';

    const [series, byStatus, byTag, busiestHours] = await Promise.all([
      granularity === 'hour'
        ? this.getHourlySeries(tenantId, start, end, timezone, agentScopeId)
        : this.getDailySeries(tenantId, from, to, timezone, agentScopeId),
      this.getConversationsByStatus(tenantId, agentScopeId),
      this.getConversationsByTag(tenantId, start, end, agentScopeId),
      this.getBusiestHours(tenantId, start, end, timezone, agentScopeId),
    ]);

    return { from, to, granularity, scope: admin ? 'tenant' as const : 'agent' as const, series, byStatus, byTag, busiestHours };
  }

  // ─── Agents (admin/owner only -- enforced by the controller's @Roles guard) ──

  async getAgentPerformance(tenantId: string, query: DateRangeQueryDto) {
    const timezone = await this.getTenantTimezone(tenantId);
    const { from, to } = resolveDateRange(query.from, query.to, timezone);
    const { start, end } = getTenantDateRangeBoundaries(from, to, timezone);

    const agents = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: [UserRole.ADMIN, UserRole.AGENT, UserRole.SUPER_ADMIN] } },
      select: { id: true, name: true, avatarUrl: true },
    });

    const rows = await Promise.all(agents.map(async (agent) => {
      const [conversationsHandled, resolvedCount, medianFirstResponseSeconds, medianResolutionSeconds] = await Promise.all([
        this.prisma.conversation.count({ where: { tenantId, assignedToId: agent.id, createdAt: { gte: start, lt: end } } }),
        this.prisma.conversation.count({ where: { tenantId, assignedToId: agent.id, resolvedAt: { gte: start, lt: end } } }),
        this.getMedianFirstResponseSeconds(tenantId, start, end, agent.id),
        this.getMedianResolutionSeconds(tenantId, start, end, agent.id),
      ]);
      return {
        agentId: agent.id, name: agent.name, avatarUrl: agent.avatarUrl,
        conversationsHandled, resolvedCount, medianFirstResponseSeconds, medianResolutionSeconds,
      };
    }));

    const teamAverage = {
      conversationsHandled: avg(rows.map((r) => r.conversationsHandled)),
      resolvedCount: avg(rows.map((r) => r.resolvedCount)),
      medianFirstResponseSeconds: avg(rows.map((r) => r.medianFirstResponseSeconds).filter((v): v is number => v != null)),
      medianResolutionSeconds: avg(rows.map((r) => r.medianResolutionSeconds).filter((v): v is number => v != null)),
    };

    return { from, to, agents: rows, teamAverage };
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────

  private async getConversationCounts(tenantId: string, start: Date, end: Date, agentScopeId?: string): Promise<ConversationCounts> {
    const rows = await this.prisma.$queryRaw<Array<{ prior_count: bigint }>>`
      SELECT (
        SELECT COUNT(*)::bigint FROM "conversations" c2
        WHERE c2.tenant_id = c.tenant_id AND c2.contact_id = c.contact_id AND c2.created_at < c.created_at
      ) AS prior_count
      FROM "conversations" c
      WHERE c.tenant_id = ${tenantId}
        AND c.created_at >= ${start} AND c.created_at < ${end}
        AND (${agentScopeId ?? null}::text IS NULL OR c.assigned_to_id = ${agentScopeId ?? null})
    `;

    let newConversations = 0;
    let returningConversations = 0;
    for (const row of rows) {
      if (row.prior_count === BigInt(0)) newConversations++;
      else returningConversations++;
    }
    return { total: newConversations + returningConversations, newConversations, returningConversations };
  }

  private async getMessageCountsForRange(tenantId: string, from: string, to: string, timezone: string): Promise<MessageCounts> {
    const today = toTenantDateString(new Date(), timezone);
    const dates = enumerateTenantDates(from, to);
    const historicalDates = dates.filter((d) => d !== today);
    const needsLiveToday = dates.includes(today);

    const [rolled, live] = await Promise.all([
      historicalDates.length > 0
        ? this.prisma.analyticsDailyMessageStats.aggregate({
            where: { tenantId, date: { in: historicalDates.map((d) => new Date(`${d}T00:00:00.000Z`)) } },
            _sum: { sentCount: true, deliveredCount: true, readCount: true, inboundCount: true, outboundCount: true },
          })
        : null,
      needsLiveToday ? this.computeMessageStatsLive(tenantId, ...Object.values(getTenantDayBoundaries(today, timezone)) as [Date, Date]) : null,
    ]);

    const sum = rolled?._sum;
    return {
      sent: (sum?.sentCount ?? 0) + (live?.sentCount ?? 0),
      delivered: (sum?.deliveredCount ?? 0) + (live?.deliveredCount ?? 0),
      read: (sum?.readCount ?? 0) + (live?.readCount ?? 0),
      replied: (sum?.inboundCount ?? 0) + (live?.inboundCount ?? 0), // see analytics.util note: "replied" == inbound message volume
    };
  }

  private async computeMessageStatsLive(tenantId: string, start: Date, end: Date) {
    const [sentCount, deliveredCount, readCount, inboundCount] = await Promise.all([
      this.prisma.message.count({ where: { tenantId, sentAt: { gte: start, lt: end } } }),
      this.prisma.message.count({ where: { tenantId, deliveredAt: { gte: start, lt: end } } }),
      this.prisma.message.count({ where: { tenantId, readAt: { gte: start, lt: end } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'INBOUND', createdAt: { gte: start, lt: end } } }),
    ]);
    return { sentCount, deliveredCount, readCount, inboundCount };
  }

  /** Median seconds from a conversation's first inbound message (in range) to the first subsequent outbound reply. */
  private async getMedianFirstResponseSeconds(tenantId: string, start: Date, end: Date, agentId?: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ median_seconds: number | null }>>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (out_msg.created_at - first_in.created_at))) AS median_seconds
      FROM (
        SELECT DISTINCT ON (conversation_id) conversation_id, created_at
        FROM messages
        WHERE tenant_id = ${tenantId} AND direction = 'INBOUND' AND created_at >= ${start} AND created_at < ${end}
        ORDER BY conversation_id, created_at ASC
      ) first_in
      JOIN LATERAL (
        SELECT created_at, sender_id FROM messages
        WHERE conversation_id = first_in.conversation_id AND direction = 'OUTBOUND' AND created_at > first_in.created_at
        ORDER BY created_at ASC
        LIMIT 1
      ) out_msg ON true
      WHERE (${agentId}::text IS NULL OR out_msg.sender_id = ${agentId})
    `;
    const value = rows[0]?.median_seconds;
    return value != null ? Math.round(Number(value)) : null;
  }

  /** Median seconds from conversation creation to resolution, for conversations resolved in range. */
  private async getMedianResolutionSeconds(tenantId: string, start: Date, end: Date, agentId?: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ median_seconds: number | null }>>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at))) AS median_seconds
      FROM conversations
      WHERE tenant_id = ${tenantId} AND resolved_at >= ${start} AND resolved_at < ${end}
        AND (${agentId}::text IS NULL OR assigned_to_id = ${agentId})
    `;
    const value = rows[0]?.median_seconds;
    return value != null ? Math.round(Number(value)) : null;
  }

  private async getRevenueForRange(tenantId: string, from: string, to: string, timezone: string) {
    const today = toTenantDateString(new Date(), timezone);
    const dates = enumerateTenantDates(from, to);
    const historicalDates = dates.filter((d) => d !== today);

    const rolled = historicalDates.length > 0
      ? await this.prisma.analyticsDailyRevenueStats.aggregate({
          where: { tenantId, date: { in: historicalDates.map((d) => new Date(`${d}T00:00:00.000Z`)) } },
          _sum: { amount: true, successCount: true, failedCount: true },
        })
      : null;

    let liveAmount = 0, liveSuccess = 0, liveFailed = 0;
    if (dates.includes(today)) {
      const { start, end } = getTenantDayBoundaries(today, timezone);
      const grouped = await this.prisma.payment.groupBy({
        by: ['status'], where: { tenantId, createdAt: { gte: start, lt: end } },
        _count: { id: true }, _sum: { amount: true },
      });
      for (const row of grouped) {
        if (row.status === 'SUCCEEDED') { liveSuccess += row._count.id; liveAmount += row._sum.amount ?? 0; }
        else if (row.status === 'FAILED') liveFailed += row._count.id;
      }
    }

    return {
      amount: round2((rolled?._sum.amount ?? 0) + liveAmount),
      currency: 'USD',
      successCount: (rolled?._sum.successCount ?? 0) + liveSuccess,
      failedCount: (rolled?._sum.failedCount ?? 0) + liveFailed,
    };
  }

  private async getRevenueByGateway(tenantId: string, from: string, to: string, timezone: string) {
    const today = toTenantDateString(new Date(), timezone);
    const dates = enumerateTenantDates(from, to);
    const historicalDates = dates.filter((d) => d !== today);

    const byGateway = new Map<string, { successCount: number; failedCount: number; amount: number }>();

    if (historicalDates.length > 0) {
      const rows = await this.prisma.analyticsDailyRevenueStats.groupBy({
        by: ['gateway'],
        where: { tenantId, date: { in: historicalDates.map((d) => new Date(`${d}T00:00:00.000Z`)) } },
        _sum: { amount: true, successCount: true, failedCount: true },
      });
      for (const row of rows) {
        byGateway.set(row.gateway, {
          successCount: row._sum.successCount ?? 0,
          failedCount: row._sum.failedCount ?? 0,
          amount: row._sum.amount ?? 0,
        });
      }
    }

    if (dates.includes(today)) {
      const { start, end } = getTenantDayBoundaries(today, timezone);
      const grouped = await this.prisma.payment.groupBy({
        by: ['gateway', 'status'], where: { tenantId, createdAt: { gte: start, lt: end } },
        _count: { id: true }, _sum: { amount: true },
      });
      for (const row of grouped) {
        const entry = byGateway.get(row.gateway) ?? { successCount: 0, failedCount: 0, amount: 0 };
        if (row.status === 'SUCCEEDED') { entry.successCount += row._count.id; entry.amount += row._sum.amount ?? 0; }
        else if (row.status === 'FAILED') entry.failedCount += row._count.id;
        byGateway.set(row.gateway, entry);
      }
    }

    return Array.from(byGateway.entries()).map(([gateway, stats]) => ({
      gateway, successCount: stats.successCount, failedCount: stats.failedCount, amount: round2(stats.amount),
    }));
  }

  // ─── Campaigns ───────────────────────────────────────────────────────────

  async getCampaignPerformance(tenantId: string, query: CampaignsQueryDto) {
    const timezone = await this.getTenantTimezone(tenantId);
    const { from, to } = resolveDateRange(query.from, query.to, timezone);
    const { start, end } = getTenantDateRangeBoundaries(from, to, timezone);
    const limit = Math.min(query.limit ?? 20, 100);
    const offset = query.offset ?? 0;

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { tenantId, createdAt: { gte: start, lt: end } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { template: { select: { id: true, name: true, status: true } } },
      }),
      this.prisma.campaign.count({ where: { tenantId, createdAt: { gte: start, lt: end } } }),
    ]);

    const campaignsWithFailures = await Promise.all(campaigns.map(async (c) => {
      const failures = await this.prisma.campaignRecipient.findMany({
        where: { campaignId: c.id, status: 'FAILED' },
        select: { errorCode: true },
      });
      const byCategory = new Map<string, number>();
      for (const f of failures) {
        const category = mapWhatsAppErrorCode(f.errorCode);
        byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
      }
      const failureBreakdown = Array.from(byCategory.entries()).map(([category, count]) => ({
        category, label: FAILURE_CATEGORY_LABELS[category as keyof typeof FAILURE_CATEGORY_LABELS], count,
      }));

      return {
        id: c.id, name: c.name, status: c.status, templateName: c.template.name,
        totalRecipients: c.totalRecipients, sentCount: c.sentCount, deliveredCount: c.deliveredCount,
        readCount: c.readCount, repliedCount: c.repliedCount, failedCount: c.failedCount, clickCount: c.clickCount,
        failureBreakdown,
      };
    }));

    // Per-template performance -- aggregated across all of the tenant's campaigns using that template
    // (not just the ones in this page), since a template's quality is a tenant-wide property.
    const templates = await this.prisma.template.findMany({
      where: { tenantId },
      select: {
        id: true, name: true, status: true,
        campaigns: { select: { sentCount: true, deliveredCount: true, readCount: true } },
      },
    });
    const templatePerformance = templates
      .filter((t) => t.campaigns.length > 0)
      .map((t) => {
        const sent = t.campaigns.reduce((s, c) => s + c.sentCount, 0);
        const delivered = t.campaigns.reduce((s, c) => s + c.deliveredCount, 0);
        const read = t.campaigns.reduce((s, c) => s + c.readCount, 0);
        return {
          templateId: t.id, name: t.name, approvalStatus: t.status,
          sentCount: sent,
          deliveryRate: sent > 0 ? round1(delivered / sent) : 0,
          readRate: delivered > 0 ? round1(read / delivered) : 0,
        };
      });

    return { from, to, campaigns: campaignsWithFailures, templatePerformance, meta: { total, limit, offset } };
  }

  // ─── WhatsApp account health ─────────────────────────────────────────────

  async getHealth(tenantId: string) {
    const numbers = await this.prisma.whatsAppNumber.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, label: true, phoneNumberId: true, qualityRating: true, messagingLimitTier: true, qualitySyncedAt: true },
    });

    const now = new Date();
    const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prev7Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [last7Blocked, prev7Blocked, last7OptedOut, prev7OptedOut] = await Promise.all([
      this.prisma.contact.count({ where: { tenantId, blockedAt: { gte: last7Start, lt: now } } }),
      this.prisma.contact.count({ where: { tenantId, blockedAt: { gte: prev7Start, lt: last7Start } } }),
      this.prisma.contact.count({ where: { tenantId, optedOutAt: { gte: last7Start, lt: now } } }),
      this.prisma.contact.count({ where: { tenantId, optedOutAt: { gte: prev7Start, lt: last7Start } } }),
    ]);

    const last7Total = last7Blocked + last7OptedOut;
    const prev7Total = prev7Blocked + prev7OptedOut;
    const spike = prev7Total > 0 ? last7Total > prev7Total * 2 : last7Total >= 3;

    return {
      numbers: numbers.length > 0 ? numbers : [],
      numbersConfigured: numbers.length > 0,
      optOuts: {
        last7Days: last7Total, previous7Days: prev7Total, spike,
        blocked: last7Blocked, optedOut: last7OptedOut,
      },
    };
  }

  // ─── Revenue (VerzChat's own subscription billing -- see PR description) ────

  async getRevenue(tenantId: string, query: DateRangeQueryDto) {
    const timezone = await this.getTenantTimezone(tenantId);
    const { from, to } = resolveDateRange(query.from, query.to, timezone);
    const byGateway = await this.getRevenueByGateway(tenantId, from, to, timezone);

    return {
      from, to,
      note: 'This reflects your own VerzChat subscription billing -- VerzChat does not track sales/revenue from your customers.',
      byGateway,
      totalAmount: round2(byGateway.reduce((s, g) => s + g.amount, 0)),
      totalSuccessCount: byGateway.reduce((s, g) => s + g.successCount, 0),
      totalFailedCount: byGateway.reduce((s, g) => s + g.failedCount, 0),
    };
  }

  private async getDailySeries(tenantId: string, from: string, to: string, timezone: string, agentScopeId?: string) {
    const dates = enumerateTenantDates(from, to);
    const today = toTenantDateString(new Date(), timezone);

    if (!agentScopeId) {
      const rolled = await this.prisma.analyticsDailyConversationStats.findMany({
        where: { tenantId, date: { in: dates.filter((d) => d !== today).map((d) => new Date(`${d}T00:00:00.000Z`)) } },
      });
      const byDate = new Map(rolled.map((r) => [toTenantDateString(r.date, 'UTC'), r]));
      return Promise.all(dates.map(async (date) => {
        if (date === today) {
          const { start, end } = getTenantDayBoundaries(date, timezone);
          const counts = await this.getConversationCounts(tenantId, start, end);
          const resolved = await this.prisma.conversation.count({ where: { tenantId, resolvedAt: { gte: start, lt: end } } });
          return { date, new: counts.newConversations, returning: counts.returningConversations, opened: counts.total, resolved };
        }
        const row = byDate.get(date);
        return { date, new: row?.newConversations ?? 0, returning: row?.returningConversations ?? 0, opened: row?.openedCount ?? 0, resolved: row?.resolvedCount ?? 0 };
      }));
    }

    // Agent-scoped: always live (bounded to one agent's conversations, cheap even over a long range)
    return Promise.all(dates.map(async (date) => {
      const { start, end } = getTenantDayBoundaries(date, timezone);
      const counts = await this.getConversationCounts(tenantId, start, end, agentScopeId);
      const resolved = await this.prisma.conversation.count({ where: { tenantId, assignedToId: agentScopeId, resolvedAt: { gte: start, lt: end } } });
      return { date, new: counts.newConversations, returning: counts.returningConversations, opened: counts.total, resolved };
    }));
  }

  private async getHourlySeries(tenantId: string, start: Date, end: Date, timezone: string, agentScopeId?: string) {
    const rows = await this.prisma.$queryRaw<Array<{ hour: Date; opened: bigint }>>`
      SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::bigint AS opened
      FROM conversations
      WHERE tenant_id = ${tenantId} AND created_at >= ${start} AND created_at < ${end}
        AND (${agentScopeId ?? null}::text IS NULL OR assigned_to_id = ${agentScopeId ?? null})
      GROUP BY 1 ORDER BY 1 ASC
    `;
    return rows.map((r) => ({ date: r.hour.toISOString(), opened: Number(r.opened) }));
  }

  private async getConversationsByStatus(tenantId: string, agentScopeId?: string) {
    const rows = await this.prisma.conversation.groupBy({
      by: ['status'],
      where: agentScopeId ? { tenantId, assignedToId: agentScopeId } : { tenantId },
      _count: { id: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count.id }));
  }

  private async getConversationsByTag(tenantId: string, start: Date, end: Date, agentScopeId?: string) {
    const convs = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        createdAt: { gte: start, lt: end },
        ...(agentScopeId && { assignedToId: agentScopeId }),
      },
      select: { labels: true },
      take: 10_000, // guardrail; tag breakdown is a top-10 summary, not a full export
    });
    const counts = new Map<string, number>();
    for (const c of convs) for (const label of c.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));
  }

  private async getBusiestHours(tenantId: string, start: Date, end: Date, timezone: string, agentScopeId?: string) {
    // Busiest-hours is about inbound customer message volume (when do customers message us),
    // which isn't meaningfully "scoped to an agent" -- accepted for both scopes as tenant-wide.
    void agentScopeId;
    const rows = await this.prisma.$queryRaw<Array<{ dow: number; hour: number; count: bigint }>>`
      SELECT
        EXTRACT(DOW FROM created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::int AS dow,
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::int AS hour,
        COUNT(*)::bigint AS count
      FROM messages
      WHERE tenant_id = ${tenantId} AND direction = 'INBOUND' AND created_at >= ${start} AND created_at < ${end}
      GROUP BY 1, 2
    `;
    return rows.map((r) => ({ dayOfWeek: r.dow, hour: r.hour, count: Number(r.count) }));
  }
}

function round1(n: number): number {
  return Math.round(n * 1000) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}
