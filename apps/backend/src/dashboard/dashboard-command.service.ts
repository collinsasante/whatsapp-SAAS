import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getTenantDateRangeBoundaries } from '../common/utils/timezone.util';
import { AnalyticsIntelligenceService } from '../analytics/analytics-intelligence.service';
import type { PeriodKpis } from '../analytics/analytics-intelligence.types';
import { effectiveReplyDeadlineMinutes } from '../conversations/reply-deadline.util';
import { buildAttentionItems, ATTENTION_KINDS } from './dashboard-attention.util';
import { resolveDashboardWindow, trendBuckets, type DashboardWindow } from './dashboard-window.util';
import type { DashboardRangeQueryDto } from './dto/dashboard-command.dto';
import type {
  AttentionConversation, DashboardAttention, DashboardMeta, DashboardSummary, DashboardTrend, PeriodSummary, TrendPoint,
} from './dashboard-command.types';

interface Range {
  start: Date;
  end: Date;
}

interface Context {
  tenantId: string;
  workspaceName: string;
  timezone: string;
  window: DashboardWindow;
  current: Range;
  previous: Range;
  meta: DashboardMeta;
}

const SAMPLE_LIMIT = 5;
/** A connection reporting an error older than this is treated as recovered, not as a current problem. */
const CHANNEL_ERROR_WINDOW_DAYS = 7;
/** A finished campaign counts as failed when at least this share of its recipients failed. */
const CAMPAIGN_FAILURE_SHARE = 0.25;
const CAMPAIGN_FAILURE_MIN = 5;

const num = (value: unknown): number => (value == null ? 0 : Number(value));

/**
 * Owner dashboard queries. Definitions of conversations, first reply, resolution and AI activity come from
 * AnalyticsIntelligenceService, so a number on the dashboard is the same number Analytics shows for the same range.
 * Every query is scoped by the tenant id taken from the authenticated user's token, never from the request.
 */
@Injectable()
export class DashboardCommandService {
  private readonly logger = new Logger(DashboardCommandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsIntelligenceService,
  ) {}

  private async context(tenantId: string, query: DashboardRangeQueryDto): Promise<Context> {
    const [tenant, settings] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } }),
    ]);
    if (!tenant) throw new NotFoundException('Workspace not found');
    const timezone = settings?.timezone ?? 'Africa/Accra';
    const window = resolveDashboardWindow(query, timezone);
    return {
      tenantId, workspaceName: tenant.name, timezone, window,
      current: getTenantDateRangeBoundaries(window.from, window.to, timezone),
      previous: getTenantDateRangeBoundaries(window.previousFrom, window.previousTo, timezone),
      meta: {
        workspaceName: tenant.name, from: window.from, to: window.to,
        previousFrom: window.previousFrom, previousTo: window.previousTo, days: window.days,
        timezone, granularity: window.granularity, generatedAt: new Date().toISOString(),
      },
    };
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  async getSummary(tenantId: string, query: DashboardRangeQueryDto): Promise<DashboardSummary> {
    const ctx = await this.context(tenantId, query);
    const [coverage, currentKpis, previousKpis, currentExtra, previousExtra] = await Promise.all([
      this.analytics.coverage(tenantId),
      this.analytics.periodKpis(tenantId, ctx.current, 'ALL'),
      this.analytics.periodKpis(tenantId, ctx.previous, 'ALL'),
      this.cohortAndOutbound(tenantId, ctx.current),
      this.cohortAndOutbound(tenantId, ctx.previous),
    ]);
    return {
      meta: ctx.meta,
      coverage,
      current: this.toSummary(currentKpis, currentExtra),
      previous: this.toSummary(previousKpis, previousExtra),
    };
  }

  private toSummary(kpis: PeriodKpis, extra: { opened: number; resolved: number; outbound: number }): PeriodSummary {
    return {
      conversations: kpis.conversations,
      newCustomers: kpis.newContacts,
      firstResponse: { samples: kpis.firstResponse.samples, medianSeconds: kpis.firstResponse.medianSeconds },
      resolution: {
        opened: extra.opened, resolved: extra.resolved,
        rate: extra.opened > 0 ? Math.round((extra.resolved / extra.opened) * 1000) / 10 : null,
      },
      engagement: { inbound: kpis.inboundMessages, outbound: extra.outbound },
      leads: { created: kpis.leads.created, qualified: kpis.leads.qualified },
      orders: { byCurrency: kpis.orders.byCurrency },
    };
  }

  /** Resolution is measured on the cohort opened in the range; outbound excludes messages that failed to send. */
  private async cohortAndOutbound(tenantId: string, r: Range) {
    const [cohort, outbound] = await Promise.all([
      this.prisma.$queryRaw<Array<{ opened: number; resolved: number }>>`
        SELECT COUNT(*)::int AS opened, COUNT(*) FILTER (WHERE c.status::text = 'RESOLVED')::int AS resolved
        FROM conversations c
        WHERE c.tenant_id = ${tenantId} AND ${this.analytics.notTest('c')}
          AND c.created_at >= ${r.start} AND c.created_at < ${r.end}
      `,
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.tenant_id = ${tenantId} AND m.direction = 'OUTBOUND' AND m.status::text <> 'FAILED'
          AND m.created_at >= ${r.start} AND m.created_at < ${r.end} AND ${this.analytics.notTest('c')}
      `,
    ]);
    return { opened: num(cohort[0]?.opened), resolved: num(cohort[0]?.resolved), outbound: num(outbound[0]?.n) };
  }

  // ─── Trend ─────────────────────────────────────────────────────────────────

  async getTrend(tenantId: string, query: DashboardRangeQueryDto): Promise<DashboardTrend> {
    const ctx = await this.context(tenantId, query);
    const { timezone, window, current } = ctx;
    const format = window.granularity === 'hour' ? 'YYYY-MM-DD HH24' : 'YYYY-MM-DD';
    const bucket = (col: string) =>
      Prisma.sql`to_char((${Prisma.raw(col)} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), ${format})`;

    const [opened, resolved, messages, channels] = await Promise.all([
      this.prisma.$queryRaw<Array<{ b: string; opened: number; new_customers: number }>>`
        SELECT ${bucket('c.created_at')} AS b, COUNT(*)::int AS opened,
          COUNT(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM conversations p
            WHERE p.tenant_id = c.tenant_id AND p.contact_id = c.contact_id
              AND p.created_at < c.created_at AND ${this.analytics.notTest('p')}
          ))::int AS new_customers
        FROM conversations c
        WHERE c.tenant_id = ${tenantId} AND ${this.analytics.notTest('c')}
          AND c.created_at >= ${current.start} AND c.created_at < ${current.end}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ b: string; n: number }>>`
        SELECT ${bucket('c.resolved_at')} AS b, COUNT(*)::int AS n
        FROM conversations c
        WHERE c.tenant_id = ${tenantId} AND ${this.analytics.notTest('c')}
          AND c.resolved_at >= ${current.start} AND c.resolved_at < ${current.end}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ b: string; inbound: number; outbound: number }>>`
        SELECT ${bucket('m.created_at')} AS b,
          COUNT(*) FILTER (WHERE m.direction = 'INBOUND')::int AS inbound,
          COUNT(*) FILTER (WHERE m.direction = 'OUTBOUND' AND m.status::text <> 'FAILED')::int AS outbound
        FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.tenant_id = ${tenantId} AND ${this.analytics.notTest('c')}
          AND m.created_at >= ${current.start} AND m.created_at < ${current.end}
        GROUP BY 1
      `,
      this.analytics.channelRows(tenantId, current, ctx.previous),
    ]);

    const openedBy = new Map(opened.map((r) => [r.b, r]));
    const resolvedBy = new Map(resolved.map((r) => [r.b, num(r.n)]));
    const messagesBy = new Map(messages.map((r) => [r.b, r]));
    const points: TrendPoint[] = trendBuckets(window).map((b) => {
      const o = openedBy.get(b);
      const m = messagesBy.get(b);
      const total = num(o?.opened);
      const fresh = num(o?.new_customers);
      return {
        bucket: b, opened: total, resolved: resolvedBy.get(b) ?? 0,
        inbound: num(m?.inbound), outbound: num(m?.outbound),
        newCustomers: fresh, returningCustomers: total - fresh,
      };
    });
    return { meta: ctx.meta, points, channels };
  }

  // ─── Needs attention ───────────────────────────────────────────────────────

  async getAttention(tenantId: string, query: DashboardRangeQueryDto): Promise<DashboardAttention> {
    const ctx = await this.context(tenantId, query);
    const now = new Date();
    const [backlog, deadlineSettings, sla, failed, campaigns, channels] = await Promise.all([
      this.analytics.backlog(tenantId, 'ALL', now),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { replyDeadlineMinutes: true } }),
      this.overdueRequests(tenantId, now),
      this.failedDeliveries(tenantId, ctx.current, now),
      this.failedCampaigns(tenantId, ctx.current),
      this.channelProblems(tenantId, now),
    ]);

    const deadline = effectiveReplyDeadlineMinutes(deadlineSettings);
    const items = buildAttentionItems({
      backlog,
      slaBreachedRequested: deadline != null ? sla : null,
      failedDeliveries: failed, failedCampaigns: campaigns, channelProblems: channels, days: ctx.window.days,
    });
    const notChecked: DashboardAttention['notChecked'] = deadline != null
      ? []
      : [{ kind: 'sla_breached', reason: 'The reply deadline is turned off. Set one in Manage, under Reply deadline.' }];
    const skipped = new Set(notChecked.map((n) => n.kind));
    return { meta: ctx.meta, items, checked: ATTENTION_KINDS.filter((k) => !skipped.has(k)), notChecked };
  }

  /** Requests still waiting for a person whose reply deadline has passed. The worker flags breaches once a minute, so the deadline itself is checked too. */
  private async overdueRequests(tenantId: string, now: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM conversations c
      WHERE c.tenant_id = ${tenantId} AND c.status::text = 'REQUESTED' AND ${this.analytics.notTest('c')}
        AND (c.sla_breached OR (c.sla_deadline IS NOT NULL AND c.sla_deadline <= ${now}))
    `;
    return num(rows[0]?.n);
  }

  private async failedDeliveries(tenantId: string, r: Range, now: Date): Promise<{ count: number; samples: AttentionConversation[] }> {
    const [counts, samples] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.tenant_id = ${tenantId} AND m.direction = 'OUTBOUND' AND m.status::text = 'FAILED'
          AND m.created_at >= ${r.start} AND m.created_at < ${r.end} AND ${this.analytics.notTest('c')}
      `,
      this.prisma.$queryRaw<Array<{ id: string; name: string | null; at: Date }>>`
        SELECT x.id, x.name, x.at FROM (
          SELECT DISTINCT ON (c.id) c.id, k.name, m.created_at AS at
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          JOIN contacts k ON k.id = c.contact_id
          WHERE m.tenant_id = ${tenantId} AND m.direction = 'OUTBOUND' AND m.status::text = 'FAILED'
            AND m.created_at >= ${r.start} AND m.created_at < ${r.end} AND ${this.analytics.notTest('c')}
          ORDER BY c.id, m.created_at DESC
        ) x ORDER BY x.at DESC LIMIT ${SAMPLE_LIMIT}
      `,
    ]);
    return {
      count: num(counts[0]?.n),
      samples: samples.map((s) => ({
        conversationId: s.id, contactName: s.name, ageSeconds: Math.max(0, Math.round((now.getTime() - s.at.getTime()) / 1000)),
      })),
    };
  }

  private async failedCampaigns(tenantId: string, r: Range): Promise<{ count: number; names: string[] }> {
    const rows = await this.prisma.campaign.findMany({
      where: {
        tenantId, updatedAt: { gte: r.start, lt: r.end },
        OR: [{ status: 'FAILED' }, { status: 'COMPLETED', failedCount: { gte: CAMPAIGN_FAILURE_MIN } }],
      },
      select: { name: true, status: true, failedCount: true, totalRecipients: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    const failed = rows.filter((c) =>
      c.status === 'FAILED' || (c.totalRecipients > 0 && c.failedCount / c.totalRecipients >= CAMPAIGN_FAILURE_SHARE));
    return { count: failed.length, names: failed.map((c) => c.name) };
  }

  /** Connections whose recorded state says they are broken. A connection with no recorded error is not reported as healthy or broken. */
  private async channelProblems(tenantId: string, now: Date): Promise<{ count: number; names: string[] }> {
    const since = new Date(now.getTime() - CHANNEL_ERROR_WINDOW_DAYS * 86_400_000);
    const [pages, sessions] = await Promise.all([
      this.prisma.facebookPageConnection.findMany({
        where: {
          tenantId, isActive: true,
          OR: [
            { lastErrorAt: { gte: since } },
            { pageAccessTokenExpiresAt: { lt: now } },
            { webhookVerified: false },
          ],
        },
        select: { pageName: true },
      }),
      this.prisma.whatsAppWebSession.findMany({
        where: { tenantId, OR: [{ status: { in: ['ERROR', 'LOGGED_OUT'] } }, { lastErrorAt: { gte: since }, status: { not: 'CONNECTED' } }] },
        select: { channel: { select: { name: true } } },
      }),
    ]);
    const names = [...pages.map((p) => p.pageName), ...sessions.map((s) => s.channel.name)];
    return { count: names.length, names };
  }
}
