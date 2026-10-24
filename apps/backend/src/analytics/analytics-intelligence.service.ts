import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserRole } from '@whatsapp-platform/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { getTenantDateRangeBoundaries, enumerateTenantDates } from '../common/utils/timezone.util';
import { resolveDateRange, resolvePreset, previousPeriod, daysInRange } from './analytics.util';
import { buildHealth, buildInsights, FIRST_RESPONSE_BUCKETS } from './analytics-insights.util';
import { IntelligenceQueryDto } from './dto/analytics.dto';
import {
  AgentRow, BacklogSnapshot, CHANNEL_GROUP_TYPES, ChannelFilter, ChannelRow, Coverage, DurationStats,
  FirstResponseStats, IntelligenceResponse, OrderRevenue, PeriodKpis, SeriesPoint, TopicRow,
} from './analytics-intelligence.types';

/** Lead statuses counted as "qualified": the lead was judged a real prospect, whether or not it has converted yet. */
const QUALIFIED_STATUSES = ['QUALIFIED', 'HOT', 'WARM', 'CONVERTED'];
/** Order statuses that mean the customer has paid and the order has not been cancelled or refunded. */
const PAID_ORDER_STATUSES = ['PAID', 'FULFILLING', 'COMPLETED'];
/**
 * Conversations that are not real customers: the AI evaluation harness, and the dashboard's own "test chat" screens.
 * Analytics must not count a team member trying out their bot as a customer conversation.
 */
export const TEST_CONTACT_SOURCES = ['eval_harness', 'dashboard_test', 'dashboard_test_ai'];
const MESSAGING_GROUPS = ['WHATSAPP', 'FACEBOOK_MESSENGER', 'INSTAGRAM'] as const;

type ChannelGroup = (typeof MESSAGING_GROUPS)[number];

interface Range {
  start: Date;
  end: Date;
}

/** Maps a stored channel type (null for legacy WhatsApp conversations created before channels existed) to a group. */
export function channelGroupOf(type: string | null): ChannelGroup | null {
  if (type == null || type === 'WHATSAPP' || type === 'WHATSAPP_WEB') return 'WHATSAPP';
  if (type === 'FACEBOOK_MESSENGER') return 'FACEBOOK_MESSENGER';
  if (type === 'INSTAGRAM') return 'INSTAGRAM';
  return null;
}

function num(value: unknown): number {
  return value == null ? 0 : Number(value);
}

function nullableNum(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function rounded(value: number | null): number | null {
  return value == null ? null : Math.round(value);
}

@Injectable()
export class AnalyticsIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  async getIntelligence(tenantId: string, query: IntelligenceQueryDto): Promise<IntelligenceResponse> {
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    const timezone = settings?.timezone ?? 'Africa/Accra';
    const { from, to } = query.preset && query.preset !== 'custom'
      ? resolvePreset(query.preset, timezone)
      : resolveDateRange(query.from, query.to, timezone);
    const prev = previousPeriod(from, to);
    const channel: ChannelFilter = query.channel ?? 'ALL';
    if (channel !== 'ALL' && !(channel in CHANNEL_GROUP_TYPES)) throw new BadRequestException('Unknown channel filter');

    const current = getTenantDateRangeBoundaries(from, to, timezone);
    const previous = getTenantDateRangeBoundaries(prev.from, prev.to, timezone);
    const now = new Date();

    const [
      currentKpis, previousKpis, series, heatmap, channels, sources, topics, productInterest, leadStatuses,
      backlog, agents, coverage, hotLeadsOpen,
    ] = await Promise.all([
      this.periodKpis(tenantId, current, channel),
      this.periodKpis(tenantId, previous, channel),
      this.series(tenantId, { from, to }, prev, timezone, channel),
      this.heatmap(tenantId, current, timezone, channel),
      this.channelRows(tenantId, current, previous),
      this.sources(tenantId, current, channel),
      this.topics(tenantId, current, previous, channel),
      this.productInterest(tenantId, current, channel),
      this.leadStatuses(tenantId, current, channel),
      this.backlog(tenantId, channel, now),
      this.agents(tenantId, current, channel),
      this.coverage(tenantId),
      this.hotLeads(tenantId, channel),
    ]);

    const days = daysInRange(from, to);
    const insightInput = {
      current: currentKpis, previous: previousKpis, backlog, heatmap,
      topics: topics.rows, labelledConversations: topics.labelledConversations,
      channels, coverage, hotLeadsOpen, days,
    };

    return {
      meta: {
        from, to, previousFrom: prev.from, previousTo: prev.to, days, timezone, channel,
        generatedAt: now.toISOString(),
      },
      coverage,
      current: currentKpis,
      previous: previousKpis,
      series, heatmap, channels, sources, topics, productInterest, leadStatuses, backlog, agents,
      insights: buildInsights(insightInput),
      health: buildHealth({ current: currentKpis, previous: previousKpis, backlog }),
    };
  }

  // ─── Fragments ─────────────────────────────────────────────────────────────

  /** Excludes test and evaluation conversations for the conversations table under the given alias (a fixed literal, never input). */
  notTest(alias: 'c' | 'p'): Prisma.Sql {
    return Prisma.sql`${Prisma.raw(`${alias}.contact_source`)} NOT IN (${Prisma.join(TEST_CONTACT_SOURCES)})`;
  }

  /**
   * Channel condition on the aliases `c` (conversations) and `ch` (channels). A conversation with no channel row is a
   * legacy WhatsApp conversation, which is why the missing type is coalesced to WHATSAPP.
   */
  channelCondition(channel: ChannelFilter, requireConversation = false): Prisma.Sql {
    if (channel === 'ALL') return Prisma.empty;
    const types = CHANNEL_GROUP_TYPES[channel];
    const typeMatch = Prisma.sql`AND COALESCE(ch.type::text, 'WHATSAPP') = ANY(${types}::text[])`;
    return requireConversation ? Prisma.sql`AND c.id IS NOT NULL ${typeMatch}` : typeMatch;
  }

  // ─── Period KPIs ───────────────────────────────────────────────────────────

  async periodKpis(tenantId: string, range: Range, channel: ChannelFilter): Promise<PeriodKpis> {
    const [
      conversations, resolved, reopened, newContacts, activity, firstResponse, resolution, sla, csat, leads, orders,
      refunded, withOrder, ai,
    ] = await Promise.all([
      this.conversationCounts(tenantId, range, channel),
      this.countByColumn(tenantId, range, channel, 'resolved_at'),
      this.countByColumn(tenantId, range, channel, 'reopened_at'),
      this.newContacts(tenantId, range, channel),
      this.activity(tenantId, range, channel),
      this.firstResponse(tenantId, range, channel),
      this.resolution(tenantId, range, channel),
      this.sla(tenantId, range, channel),
      this.csat(tenantId, range, channel),
      this.leadCounts(tenantId, range, channel),
      this.orderRevenue(tenantId, range, channel),
      this.refundedOrders(tenantId, range, channel),
      this.conversationsWithPaidOrder(tenantId, range, channel),
      this.aiKpis(tenantId, range, channel),
    ]);

    return {
      conversations, resolved, reopened, newContacts,
      activeContacts: activity.active, inboundMessages: activity.inbound,
      firstResponse, resolution, sla, csat, leads,
      orders: { byCurrency: orders, refunded, conversationsWithPaidOrder: withOrder },
      ai,
    };
  }

  private async conversationCounts(tenantId: string, r: Range, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ total: number; new_contact: number }>>`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM conversations p
          WHERE p.tenant_id = c.tenant_id AND p.contact_id = c.contact_id
            AND p.created_at < c.created_at AND ${this.notTest('p')}
        ))::int AS new_contact
      FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
        AND c.created_at >= ${r.start} AND c.created_at < ${r.end} ${this.channelCondition(channel)}
    `;
    const total = num(rows[0]?.total);
    const newContact = num(rows[0]?.new_contact);
    return { total, newContact, returningContact: total - newContact };
  }

  /** Counts conversations whose given timestamp column falls in the range. `column` is never user input. */
  private async countByColumn(tenantId: string, r: Range, channel: ChannelFilter, column: 'resolved_at' | 'reopened_at'): Promise<number> {
    const col = Prisma.raw(`c.${column}`);
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
        AND ${col} >= ${r.start} AND ${col} < ${r.end} ${this.channelCondition(channel)}
    `;
    return num(rows[0]?.n);
  }

  private async newContacts(tenantId: string, r: Range, channel: ChannelFilter): Promise<number> {
    const inChannel = channel === 'ALL' ? Prisma.empty : Prisma.sql`
      AND EXISTS (
        SELECT 1 FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE c.contact_id = k.id ${this.channelCondition(channel)}
      )`;
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM contacts k
      WHERE k.tenant_id = ${tenantId} AND NOT k.is_eval_contact
        AND k.created_at >= ${r.start} AND k.created_at < ${r.end} ${inChannel}
    `;
    return num(rows[0]?.n);
  }

  private async activity(tenantId: string, r: Range, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ active: number; inbound: number }>>`
      SELECT COUNT(DISTINCT m.contact_id)::int AS active, COUNT(*)::int AS inbound
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE m.tenant_id = ${tenantId} AND m.direction = 'INBOUND'
        AND m.created_at >= ${r.start} AND m.created_at < ${r.end}
        AND ${this.notTest('c')} ${this.channelCondition(channel)}
    `;
    return { active: num(rows[0]?.active), inbound: num(rows[0]?.inbound) };
  }

  /**
   * First reply time, for conversations opened in the range: seconds from the customer's first message to the first
   * outbound message after it. "Any" counts Verz AI and automations; "human" only counts a reply sent by a person.
   */
  private async firstResponse(tenantId: string, r: Range, channel: ChannelFilter): Promise<FirstResponseStats> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, number | null>>>`
      WITH conv AS (
        SELECT c.id FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
          AND c.created_at >= ${r.start} AND c.created_at < ${r.end} ${this.channelCondition(channel)}
      ), fr AS (
        SELECT EXTRACT(EPOCH FROM (oa.created_at - i.created_at))::float8 AS any_s,
               CASE WHEN oh.created_at IS NULL THEN NULL
                    ELSE EXTRACT(EPOCH FROM (oh.created_at - i.created_at))::float8 END AS human_s
        FROM conv
        JOIN LATERAL (
          SELECT created_at FROM messages WHERE conversation_id = conv.id AND direction = 'INBOUND'
          ORDER BY created_at ASC LIMIT 1
        ) i ON true
        JOIN LATERAL (
          SELECT created_at FROM messages WHERE conversation_id = conv.id AND direction = 'OUTBOUND' AND created_at > i.created_at
            AND status::text <> 'FAILED'
          ORDER BY created_at ASC LIMIT 1
        ) oa ON true
        LEFT JOIN LATERAL (
          SELECT m.created_at FROM messages m JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = conv.id AND m.direction = 'OUTBOUND' AND m.created_at > i.created_at AND NOT u.is_ai_agent
            AND m.status::text <> 'FAILED'
          ORDER BY m.created_at ASC LIMIT 1
        ) oh ON true
      )
      SELECT COUNT(any_s)::int AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY any_s)::float8 AS med,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY any_s)::float8 AS p90,
        AVG(any_s)::float8 AS mean,
        COUNT(*) FILTER (WHERE any_s < 300)::int AS b1,
        COUNT(*) FILTER (WHERE any_s >= 300 AND any_s < 900)::int AS b2,
        COUNT(*) FILTER (WHERE any_s >= 900 AND any_s < 3600)::int AS b3,
        COUNT(*) FILTER (WHERE any_s >= 3600 AND any_s < 14400)::int AS b4,
        COUNT(*) FILTER (WHERE any_s >= 14400)::int AS b5,
        COUNT(human_s)::int AS hn,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY human_s)::float8 AS hmed,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY human_s)::float8 AS hp90,
        AVG(human_s)::float8 AS hmean
      FROM fr
    `;
    const row = rows[0] ?? {};
    const counts = [row.b1, row.b2, row.b3, row.b4, row.b5].map(num);
    return {
      samples: num(row.n),
      medianSeconds: rounded(nullableNum(row.med)),
      p90Seconds: rounded(nullableNum(row.p90)),
      meanSeconds: rounded(nullableNum(row.mean)),
      buckets: FIRST_RESPONSE_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, count: counts[i] })),
      human: {
        samples: num(row.hn),
        medianSeconds: rounded(nullableNum(row.hmed)),
        p90Seconds: rounded(nullableNum(row.hp90)),
        meanSeconds: rounded(nullableNum(row.hmean)),
      },
    };
  }

  private async resolution(tenantId: string, r: Range, channel: ChannelFilter): Promise<DurationStats> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, number | null>>>`
      SELECT COUNT(*)::int AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)))::float8 AS med,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)))::float8 AS p90,
        AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)))::float8 AS mean
      FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
        AND c.resolved_at >= ${r.start} AND c.resolved_at < ${r.end} ${this.channelCondition(channel)}
    `;
    const row = rows[0] ?? {};
    return {
      samples: num(row.n),
      medianSeconds: rounded(nullableNum(row.med)),
      p90Seconds: rounded(nullableNum(row.p90)),
      meanSeconds: rounded(nullableNum(row.mean)),
    };
  }

  private async sla(tenantId: string, r: Range, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ tracked: number; breached: number }>>`
      SELECT COUNT(*) FILTER (WHERE c.sla_deadline IS NOT NULL)::int AS tracked,
             COUNT(*) FILTER (WHERE c.sla_deadline IS NOT NULL AND c.sla_breached)::int AS breached
      FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
        AND c.created_at >= ${r.start} AND c.created_at < ${r.end} ${this.channelCondition(channel)}
    `;
    return { tracked: num(rows[0]?.tracked), breached: num(rows[0]?.breached) };
  }

  private async csat(tenantId: string, r: Range, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ n: number; average: number | null }>>`
      SELECT COUNT(c.csat_score)::int AS n, AVG(c.csat_score)::float8 AS average
      FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE c.tenant_id = ${tenantId} AND c.csat_score IS NOT NULL
        AND c.csat_submitted_at >= ${r.start} AND c.csat_submitted_at < ${r.end} ${this.channelCondition(channel)}
    `;
    const average = nullableNum(rows[0]?.average);
    return { responses: num(rows[0]?.n), average: average == null ? null : Math.round(average * 100) / 100 };
  }

  private async leadCounts(tenantId: string, r: Range, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ status: string; n: number }>>`
      SELECT l.status::text AS status, COUNT(*)::int AS n
      FROM leads l
      JOIN conversations c ON c.id = l.conversation_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE l.tenant_id = ${tenantId} AND l.created_at >= ${r.start} AND l.created_at < ${r.end}
        AND ${this.notTest('c')} ${this.channelCondition(channel)}
      GROUP BY 1
    `;
    let created = 0, qualified = 0, converted = 0;
    for (const row of rows) {
      created += num(row.n);
      if (QUALIFIED_STATUSES.includes(row.status)) qualified += num(row.n);
      if (row.status === 'CONVERTED') converted += num(row.n);
    }
    return { created, qualified, converted };
  }

  private async orderRevenue(tenantId: string, r: Range, channel: ChannelFilter): Promise<OrderRevenue[]> {
    const rows = await this.prisma.$queryRaw<Array<{ currency: string; n: number; revenue: number }>>`
      SELECT o.currency, COUNT(*)::int AS n, COALESCE(SUM(o.total_major_units), 0)::float8 AS revenue
      FROM commerce_orders o
      LEFT JOIN conversations c ON c.id = o.conversation_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE o.tenant_id = ${tenantId} AND NOT o.is_eval_order
        AND o.paid_at >= ${r.start} AND o.paid_at < ${r.end}
        AND o.status::text = ANY(${PAID_ORDER_STATUSES}::text[])
        AND (c.id IS NULL OR ${this.notTest('c')}) ${this.channelCondition(channel, true)}
      GROUP BY o.currency ORDER BY revenue DESC
    `;
    return rows.map((row) => ({ currency: row.currency, paidOrders: num(row.n), revenue: Math.round(num(row.revenue) * 100) / 100 }));
  }

  private async refundedOrders(tenantId: string, r: Range, channel: ChannelFilter): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM commerce_orders o
      LEFT JOIN conversations c ON c.id = o.conversation_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE o.tenant_id = ${tenantId} AND NOT o.is_eval_order AND o.status::text = 'REFUNDED'
        AND o.paid_at >= ${r.start} AND o.paid_at < ${r.end}
        AND (c.id IS NULL OR ${this.notTest('c')}) ${this.channelCondition(channel, true)}
    `;
    return num(rows[0]?.n);
  }

  private async conversationsWithPaidOrder(tenantId: string, r: Range, channel: ChannelFilter): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
        AND c.created_at >= ${r.start} AND c.created_at < ${r.end} ${this.channelCondition(channel)}
        AND EXISTS (
          SELECT 1 FROM commerce_orders o
          WHERE o.conversation_id = c.id AND NOT o.is_eval_order AND o.paid_at IS NOT NULL
            AND o.status::text = ANY(${PAID_ORDER_STATUSES}::text[])
        )
    `;
    return num(rows[0]?.n);
  }

  /** Verz AI measures. Message text is never selected here: only statuses, counts and scores. */
  async aiKpis(tenantId: string, r: Range, channel: ChannelFilter): Promise<PeriodKpis['ai']> {
    const [byStatus, handed, resolvedWithout, credits] = await Promise.all([
      this.prisma.$queryRaw<Array<{ status: string; n: number; conf_sum: number | null; conf_n: number }>>`
        SELECT l.status, COUNT(*)::int AS n, SUM(l.confidence_score)::float8 AS conf_sum, COUNT(l.confidence_score)::int AS conf_n
        FROM ai_interaction_logs l
        JOIN conversations c ON c.id = l.conversation_id
        LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE l.tenant_id = ${tenantId} AND l.created_at >= ${r.start} AND l.created_at < ${r.end}
          AND ${this.notTest('c')} ${this.channelCondition(channel)}
        GROUP BY l.status
      `,
      this.prisma.$queryRaw<Array<{ engaged: number; handed: number }>>`
        SELECT COUNT(DISTINCT l.conversation_id)::int AS engaged,
          COUNT(DISTINCT l.conversation_id) FILTER (WHERE EXISTS (
            SELECT 1 FROM conversation_events e
            WHERE e.conversation_id = l.conversation_id AND e.type::text IN ('REQUESTED', 'INTERVENED')
              AND e.created_at >= l.created_at AND e.created_at < ${r.end}
          ))::int AS handed
        FROM ai_interaction_logs l
        JOIN conversations c ON c.id = l.conversation_id
        LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE l.tenant_id = ${tenantId} AND l.created_at >= ${r.start} AND l.created_at < ${r.end}
          AND ${this.notTest('c')} ${this.channelCondition(channel)}
      `,
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
          AND c.resolved_at >= ${r.start} AND c.resolved_at < ${r.end} ${this.channelCondition(channel)}
          AND EXISTS (SELECT 1 FROM ai_interaction_logs l WHERE l.conversation_id = c.id AND l.status = 'AUTO_SENT')
          AND NOT EXISTS (
            SELECT 1 FROM messages m JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = c.id AND m.direction = 'OUTBOUND' AND NOT u.is_ai_agent
          )
      `,
      // Credit usage is billed per workspace, not per channel, so it is only reported without a channel filter.
      channel === 'ALL'
        ? this.prisma.$queryRaw<Array<{ used: number }>>`
            SELECT COALESCE(-SUM(credits), 0)::int AS used FROM ai_credit_transactions
            WHERE tenant_id = ${tenantId} AND type::text = 'AI_USAGE' AND created_at >= ${r.start} AND created_at < ${r.end}
          `
        : Promise.resolve<Array<{ used: number | null }>>([{ used: null }]),
    ]);

    const n = (status: string) => num(byStatus.find((s) => s.status === status)?.n);
    const confSum = byStatus.reduce((s, row) => s + num(row.conf_sum), 0);
    const confN = byStatus.reduce((s, row) => s + num(row.conf_n), 0);
    const suggestions = n('SUGGESTED') + n('APPROVED') + n('EDITED') + n('REJECTED');

    return {
      engagedConversations: num(handed[0]?.engaged),
      autoReplies: n('AUTO_SENT'),
      suggestions,
      suggestionsSent: n('APPROVED') + n('EDITED'),
      suggestionsEdited: n('EDITED'),
      suggestionsRejected: n('REJECTED'),
      averageConfidence: confN > 0 ? Math.round((confSum / confN) * 100) / 100 : null,
      handedToPerson: num(handed[0]?.handed),
      resolvedWithoutPerson: num(resolvedWithout[0]?.n),
      creditsUsed: credits[0]?.used == null ? null : num(credits[0].used),
    };
  }

  // ─── Series, heatmap and breakdowns ────────────────────────────────────────

  private async dailyCounts(
    tenantId: string, r: Range, timezone: string, channel: ChannelFilter, kind: 'opened' | 'resolved' | 'contacts' | 'inbound',
  ): Promise<Map<string, number>> {
    const day = (col: Prisma.Sql) => Prisma.sql`to_char((${col} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}), 'YYYY-MM-DD')`;
    let rows: Array<{ day: string; n: number }>;
    if (kind === 'opened' || kind === 'resolved') {
      const col = Prisma.raw(kind === 'opened' ? 'c.created_at' : 'c.resolved_at');
      rows = await this.prisma.$queryRaw`
        SELECT ${day(col)} AS day, COUNT(*)::int AS n
        FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
          AND ${col} >= ${r.start} AND ${col} < ${r.end} ${this.channelCondition(channel)}
        GROUP BY 1
      `;
    } else if (kind === 'contacts') {
      const inChannel = channel === 'ALL' ? Prisma.empty : Prisma.sql`
        AND EXISTS (SELECT 1 FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id WHERE c.contact_id = k.id ${this.channelCondition(channel)})`;
      rows = await this.prisma.$queryRaw`
        SELECT ${day(Prisma.raw('k.created_at'))} AS day, COUNT(*)::int AS n
        FROM contacts k
        WHERE k.tenant_id = ${tenantId} AND NOT k.is_eval_contact
          AND k.created_at >= ${r.start} AND k.created_at < ${r.end} ${inChannel}
        GROUP BY 1
      `;
    } else {
      rows = await this.prisma.$queryRaw`
        SELECT ${day(Prisma.raw('m.created_at'))} AS day, COUNT(*)::int AS n
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE m.tenant_id = ${tenantId} AND m.direction = 'INBOUND'
          AND m.created_at >= ${r.start} AND m.created_at < ${r.end}
          AND ${this.notTest('c')} ${this.channelCondition(channel)}
        GROUP BY 1
      `;
    }
    return new Map(rows.map((row) => [row.day, num(row.n)]));
  }

  async series(
    tenantId: string, cur: { from: string; to: string }, prev: { from: string; to: string }, timezone: string, channel: ChannelFilter,
  ): Promise<SeriesPoint[]> {
    const curRange = getTenantDateRangeBoundaries(cur.from, cur.to, timezone);
    const prevRange = getTenantDateRangeBoundaries(prev.from, prev.to, timezone);
    const [opened, resolved, contacts, inbound, previousOpened] = await Promise.all([
      this.dailyCounts(tenantId, curRange, timezone, channel, 'opened'),
      this.dailyCounts(tenantId, curRange, timezone, channel, 'resolved'),
      this.dailyCounts(tenantId, curRange, timezone, channel, 'contacts'),
      this.dailyCounts(tenantId, curRange, timezone, channel, 'inbound'),
      this.dailyCounts(tenantId, prevRange, timezone, channel, 'opened'),
    ]);
    const dates = enumerateTenantDates(cur.from, cur.to);
    const prevDates = enumerateTenantDates(prev.from, prev.to);
    return dates.map((date, i) => ({
      date,
      opened: opened.get(date) ?? 0,
      resolved: resolved.get(date) ?? 0,
      newContacts: contacts.get(date) ?? 0,
      inbound: inbound.get(date) ?? 0,
      previousOpened: previousOpened.get(prevDates[i] ?? '') ?? 0,
    }));
  }

  private async heatmap(tenantId: string, r: Range, timezone: string, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ dow: number; hour: number; n: number }>>`
      SELECT EXTRACT(DOW FROM m.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::int AS dow,
             EXTRACT(HOUR FROM m.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::int AS hour,
             COUNT(*)::int AS n
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE m.tenant_id = ${tenantId} AND m.direction = 'INBOUND'
        AND m.created_at >= ${r.start} AND m.created_at < ${r.end}
        AND ${this.notTest('c')} ${this.channelCondition(channel)}
      GROUP BY 1, 2
    `;
    return rows.map((row) => ({ dayOfWeek: num(row.dow), hour: num(row.hour), count: num(row.n) }));
  }

  /** Always unfiltered by channel: this is the table that compares the channels with one another. */
  async channelRows(tenantId: string, cur: Range, prev: Range): Promise<ChannelRow[]> {
    const grouped = async (r: Range) => this.prisma.$queryRaw<Array<{ type: string | null; n: number }>>`
      SELECT ch.type::text AS type, COUNT(*)::int AS n
      FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
        AND c.created_at >= ${r.start} AND c.created_at < ${r.end}
      GROUP BY 1
    `;
    const [now, before, leads, orders] = await Promise.all([
      grouped(cur), grouped(prev),
      this.prisma.$queryRaw<Array<{ type: string | null; n: number }>>`
        SELECT ch.type::text AS type, COUNT(*)::int AS n
        FROM leads l JOIN conversations c ON c.id = l.conversation_id LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE l.tenant_id = ${tenantId} AND l.created_at >= ${cur.start} AND l.created_at < ${cur.end}
          AND l.status::text = ANY(${QUALIFIED_STATUSES}::text[]) AND ${this.notTest('c')}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ type: string | null; n: number }>>`
        SELECT ch.type::text AS type, COUNT(*)::int AS n
        FROM commerce_orders o JOIN conversations c ON c.id = o.conversation_id LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE o.tenant_id = ${tenantId} AND NOT o.is_eval_order AND o.paid_at >= ${cur.start} AND o.paid_at < ${cur.end}
          AND o.status::text = ANY(${PAID_ORDER_STATUSES}::text[]) AND ${this.notTest('c')}
        GROUP BY 1
      `,
    ]);

    const sum = (rows: Array<{ type: string | null; n: number }>, group: ChannelGroup) =>
      rows.filter((row) => channelGroupOf(row.type) === group).reduce((s, row) => s + num(row.n), 0);
    return MESSAGING_GROUPS.map((group) => ({
      channel: group,
      conversations: sum(now, group),
      previousConversations: sum(before, group),
      qualifiedLeads: sum(leads, group),
      paidOrders: sum(orders, group),
    }));
  }

  private async sources(tenantId: string, r: Range, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ source: string; n: number }>>`
      SELECT c.contact_source AS source, COUNT(*)::int AS n
      FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
        AND c.created_at >= ${r.start} AND c.created_at < ${r.end} ${this.channelCondition(channel)}
      GROUP BY 1 ORDER BY n DESC LIMIT 8
    `;
    return rows.map((row) => ({ source: row.source, conversations: num(row.n) }));
  }

  private async topics(tenantId: string, cur: Range, prev: Range, channel: ChannelFilter) {
    const labelCounts = (r: Range) => this.prisma.$queryRaw<Array<{ label: string; n: number; unresolved: number }>>`
      SELECT label, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE c.status::text <> 'RESOLVED')::int AS unresolved
      FROM conversations c
      LEFT JOIN channels ch ON ch.id = c.channel_id
      CROSS JOIN LATERAL unnest(c.labels) AS label
      WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
        AND c.created_at >= ${r.start} AND c.created_at < ${r.end} ${this.channelCondition(channel)}
      GROUP BY label ORDER BY n DESC LIMIT 200
    `;
    const [now, before, totals] = await Promise.all([
      labelCounts(cur), labelCounts(prev),
      this.prisma.$queryRaw<Array<{ total: number; labelled: number }>>`
        SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE cardinality(c.labels) > 0)::int AS labelled
        FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
          AND c.created_at >= ${cur.start} AND c.created_at < ${cur.end} ${this.channelCondition(channel)}
      `,
    ]);
    const previousByLabel = new Map(before.map((row) => [row.label, num(row.n)]));
    const rows: TopicRow[] = now.slice(0, 10).map((row) => ({
      label: row.label, conversations: num(row.n), unresolved: num(row.unresolved),
      previousConversations: previousByLabel.get(row.label) ?? 0,
    }));
    return { rows, labelledConversations: num(totals[0]?.labelled), totalConversations: num(totals[0]?.total) };
  }

  private async productInterest(tenantId: string, r: Range, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ product: string; n: number }>>`
      SELECT (array_agg(trim(l.product_interest) ORDER BY l.created_at DESC))[1] AS product, COUNT(*)::int AS n
      FROM leads l
      JOIN conversations c ON c.id = l.conversation_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE l.tenant_id = ${tenantId} AND l.created_at >= ${r.start} AND l.created_at < ${r.end}
        AND l.product_interest IS NOT NULL AND trim(l.product_interest) <> ''
        AND ${this.notTest('c')} ${this.channelCondition(channel)}
      GROUP BY lower(trim(l.product_interest)) ORDER BY n DESC LIMIT 8
    `;
    return rows.map((row) => ({ product: row.product, leads: num(row.n) }));
  }

  private async leadStatuses(tenantId: string, r: Range, channel: ChannelFilter) {
    const rows = await this.prisma.$queryRaw<Array<{ status: string; n: number }>>`
      SELECT l.status::text AS status, COUNT(*)::int AS n
      FROM leads l
      JOIN conversations c ON c.id = l.conversation_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE l.tenant_id = ${tenantId} AND l.created_at >= ${r.start} AND l.created_at < ${r.end}
        AND ${this.notTest('c')} ${this.channelCondition(channel)}
      GROUP BY 1 ORDER BY n DESC
    `;
    return rows.map((row) => ({ status: row.status, count: num(row.n) }));
  }

  private async hotLeads(tenantId: string, channel: ChannelFilter): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM leads l
      JOIN conversations c ON c.id = l.conversation_id
      LEFT JOIN channels ch ON ch.id = c.channel_id
      WHERE l.tenant_id = ${tenantId} AND l.status::text = 'HOT' AND ${this.notTest('c')} ${this.channelCondition(channel)}
    `;
    return num(rows[0]?.n);
  }

  // ─── Backlog (a snapshot of right now, not bound to the date range) ────────

  async backlog(tenantId: string, channel: ChannelFilter, now: Date): Promise<BacklogSnapshot> {
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const openWhere = Prisma.sql`
      c.tenant_id = ${tenantId} AND ${this.notTest('c')} AND c.status::text NOT IN ('RESOLVED', 'SNOOZED')
      ${this.channelCondition(channel)}`;

    const [summary, waiting] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, number | Date | null>>>`
        SELECT COUNT(*)::int AS open,
          COUNT(*) FILTER (WHERE c.assigned_to_id IS NULL)::int AS unassigned,
          COUNT(*) FILTER (WHERE c.sla_breached)::int AS sla_breached,
          COUNT(*) FILTER (WHERE lm.direction = 'INBOUND')::int AS awaiting,
          COUNT(*) FILTER (WHERE lm.direction = 'INBOUND' AND lm.created_at < ${hourAgo})::int AS awaiting_hour,
          MIN(lm.created_at) FILTER (WHERE lm.direction = 'INBOUND') AS oldest
        FROM conversations c
        LEFT JOIN channels ch ON ch.id = c.channel_id
        LEFT JOIN LATERAL (
          SELECT direction, created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
        ) lm ON true
        WHERE ${openWhere}
      `,
      this.prisma.$queryRaw<Array<{ id: string; name: string | null; type: string | null; since: Date; agent: string | null }>>`
        SELECT c.id, k.name, ch.type::text AS type, lm.created_at AS since, u.name AS agent
        FROM conversations c
        JOIN contacts k ON k.id = c.contact_id
        LEFT JOIN channels ch ON ch.id = c.channel_id
        LEFT JOIN users u ON u.id = c.assigned_to_id
        JOIN LATERAL (
          SELECT direction, created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
        ) lm ON lm.direction = 'INBOUND'
        WHERE ${openWhere}
        ORDER BY lm.created_at ASC LIMIT 8
      `,
    ]);

    const s = summary[0] ?? {};
    const oldest = s.oldest instanceof Date ? s.oldest : null;
    return {
      open: num(s.open),
      unassigned: num(s.unassigned),
      slaBreached: num(s.sla_breached),
      awaitingReply: num(s.awaiting),
      awaitingReplyOverHour: num(s.awaiting_hour),
      oldestWaitingSeconds: oldest ? Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000)) : null,
      waiting: waiting.map((row) => ({
        conversationId: row.id,
        contactName: row.name,
        channel: channelGroupOf(row.type) ?? 'WHATSAPP',
        waitingSeconds: Math.max(0, Math.round((now.getTime() - row.since.getTime()) / 1000)),
        assignedTo: row.agent,
      })),
    };
  }

  // ─── Agents (people only: the Verz AI user is excluded) ────────────────────

  async agents(tenantId: string, r: Range, channel: ChannelFilter): Promise<AgentRow[]> {
    const people = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, isAiAgent: false, role: { in: [UserRole.ADMIN, UserRole.AGENT, UserRole.SUPER_ADMIN] } },
      select: { id: true, name: true, avatarUrl: true },
    });
    if (people.length === 0) return [];

    const [load, resolution, csat, firstReply] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; assigned: number; resolved: number; reopened: number; open_now: number }>>`
        SELECT c.assigned_to_id AS id,
          COUNT(*) FILTER (WHERE c.created_at >= ${r.start} AND c.created_at < ${r.end})::int AS assigned,
          COUNT(*) FILTER (WHERE c.resolved_at >= ${r.start} AND c.resolved_at < ${r.end})::int AS resolved,
          COUNT(*) FILTER (WHERE c.reopened_at >= ${r.start} AND c.reopened_at < ${r.end})::int AS reopened,
          COUNT(*) FILTER (WHERE c.status::text NOT IN ('RESOLVED', 'SNOOZED'))::int AS open_now
        FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE c.tenant_id = ${tenantId} AND c.assigned_to_id IS NOT NULL AND ${this.notTest('c')}
          AND (c.created_at >= ${r.start} OR c.resolved_at >= ${r.start} OR c.reopened_at >= ${r.start}
               OR c.status::text NOT IN ('RESOLVED', 'SNOOZED')) ${this.channelCondition(channel)}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ id: string; n: number; med: number | null; p90: number | null; mean: number | null }>>`
        SELECT c.assigned_to_id AS id, COUNT(*)::int AS n,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)))::float8 AS med,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)))::float8 AS p90,
          AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)))::float8 AS mean
        FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE c.tenant_id = ${tenantId} AND c.assigned_to_id IS NOT NULL AND ${this.notTest('c')}
          AND c.resolved_at >= ${r.start} AND c.resolved_at < ${r.end} ${this.channelCondition(channel)}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ id: string; n: number; average: number | null }>>`
        SELECT c.assigned_to_id AS id, COUNT(c.csat_score)::int AS n, AVG(c.csat_score)::float8 AS average
        FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
        WHERE c.tenant_id = ${tenantId} AND c.assigned_to_id IS NOT NULL AND c.csat_score IS NOT NULL
          AND c.csat_submitted_at >= ${r.start} AND c.csat_submitted_at < ${r.end} ${this.channelCondition(channel)}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<Array<{ id: string; n: number; med: number | null; p90: number | null; mean: number | null }>>`
        WITH conv AS (
          SELECT c.id FROM conversations c LEFT JOIN channels ch ON ch.id = c.channel_id
          WHERE c.tenant_id = ${tenantId} AND ${this.notTest('c')}
            AND c.created_at >= ${r.start} AND c.created_at < ${r.end} ${this.channelCondition(channel)}
        ), fr AS (
          SELECT oh.sender_id AS id, EXTRACT(EPOCH FROM (oh.created_at - i.created_at))::float8 AS secs
          FROM conv
          JOIN LATERAL (
            SELECT created_at FROM messages WHERE conversation_id = conv.id AND direction = 'INBOUND'
            ORDER BY created_at ASC LIMIT 1
          ) i ON true
          JOIN LATERAL (
            SELECT m.created_at, m.sender_id FROM messages m JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = conv.id AND m.direction = 'OUTBOUND' AND m.created_at > i.created_at AND NOT u.is_ai_agent
            AND m.status::text <> 'FAILED'
            ORDER BY m.created_at ASC LIMIT 1
          ) oh ON true
        )
        SELECT id, COUNT(*)::int AS n,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)::float8 AS med,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY secs)::float8 AS p90,
          AVG(secs)::float8 AS mean
        FROM fr GROUP BY id
      `,
    ]);

    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
    const loadById = byId(load), resolutionById = byId(resolution), csatById = byId(csat), replyById = byId(firstReply);
    const stats = (row?: { n: number; med: number | null; p90: number | null; mean: number | null }): DurationStats => ({
      samples: num(row?.n), medianSeconds: rounded(nullableNum(row?.med)),
      p90Seconds: rounded(nullableNum(row?.p90)), meanSeconds: rounded(nullableNum(row?.mean)),
    });

    return people.map((p) => {
      const l = loadById.get(p.id);
      const cs = csatById.get(p.id);
      const avg = nullableNum(cs?.average);
      return {
        agentId: p.id, name: p.name, avatarUrl: p.avatarUrl,
        assigned: num(l?.assigned), resolved: num(l?.resolved), openNow: num(l?.open_now), reopened: num(l?.reopened),
        firstResponse: stats(replyById.get(p.id)),
        resolution: stats(resolutionById.get(p.id)),
        csat: { responses: num(cs?.n), average: avg == null ? null : Math.round(avg * 100) / 100 },
      };
    }).filter((a) => a.assigned + a.resolved + a.openNow + a.firstResponse.samples > 0)
      .sort((a, b) => b.resolved - a.resolved || a.name.localeCompare(b.name));
  }

  async coverage(tenantId: string): Promise<Coverage> {
    const rows = await this.prisma.$queryRaw<Array<Coverage>>`
      SELECT
        EXISTS (SELECT 1 FROM commerce_orders WHERE tenant_id = ${tenantId} AND NOT is_eval_order) AS orders,
        EXISTS (SELECT 1 FROM leads WHERE tenant_id = ${tenantId}) AS leads,
        EXISTS (SELECT 1 FROM ai_interaction_logs WHERE tenant_id = ${tenantId}) AS ai,
        EXISTS (SELECT 1 FROM conversations WHERE tenant_id = ${tenantId} AND sla_deadline IS NOT NULL) AS sla,
        EXISTS (SELECT 1 FROM conversations WHERE tenant_id = ${tenantId} AND csat_score IS NOT NULL) AS csat
    `;
    const row = rows[0];
    return { orders: !!row?.orders, leads: !!row?.leads, ai: !!row?.ai, sla: !!row?.sla, csat: !!row?.csat };
  }
}
