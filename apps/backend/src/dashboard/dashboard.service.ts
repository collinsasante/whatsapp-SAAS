import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignStatus, ConversationStatus, JwtPayload, TemplateStatus, UserRole } from '@whatsapp-platform/shared-types';
import { getTenantDayBoundaries, toTenantDateString } from '../common/utils/timezone.util';
import { isWindowClosingSoon, hoursRemainingInWindow } from './dashboard.util';

const STAT_CACHE_TTL_MS = 30_000;
const CONTACT_SELECT = { select: { id: true, name: true, phone: true } } as const;

function isAdminRole(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

interface CachedToday { data: unknown; expiresAt: number }

@Injectable()
export class DashboardService {
  private readonly todayCache = new Map<string, CachedToday>();

  constructor(private readonly prisma: PrismaService) {}

  private async getTenantTimezone(tenantId: string): Promise<string> {
    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    return settings?.timezone ?? 'Africa/Accra';
  }

  async getDashboard(tenantId: string, requester: JwtPayload) {
    const admin = isAdminRole(requester.role);
    const agentScopeId = admin ? undefined : requester.sub;
    const timezone = await this.getTenantTimezone(tenantId);

    const [needsAttention, today, health, activity, recentCampaigns, setupChecklist] = await Promise.all([
      this.getNeedsAttention(tenantId, agentScopeId),
      this.getToday(tenantId, agentScopeId, admin, timezone),
      this.getHealth(tenantId),
      this.getActivity(tenantId),
      this.getRecentCampaigns(tenantId),
      admin ? this.getSetupChecklist(tenantId) : Promise.resolve(null),
    ]);

    return {
      scope: admin ? 'tenant' as const : 'agent' as const,
      needsAttention,
      today,
      health,
      activity,
      recentCampaigns,
      setupChecklist,
    };
  }

  // ─── Needs attention ─────────────────────────────────────────────────────

  private async getNeedsAttention(tenantId: string, agentScopeId?: string) {
    const [unassigned, windowClosingSoon, slaBreaching] = await Promise.all([
      this.getUnassigned(tenantId, agentScopeId),
      this.getWindowClosingSoon(tenantId, agentScopeId),
      this.getSlaBreaching(tenantId, agentScopeId),
    ]);
    return { unassigned, windowClosingSoon, slaBreaching };
  }

  /** Unassigned open conversations only make sense tenant-wide -- an agent has none "unassigned" to them. */
  private async getUnassigned(tenantId: string, agentScopeId?: string) {
    if (agentScopeId) return { count: 0, items: [] as unknown[] };

    const [count, items] = await Promise.all([
      this.prisma.conversation.count({ where: { tenantId, assignedToId: null, status: { in: [ConversationStatus.OPEN, ConversationStatus.REQUESTED] } } }),
      this.prisma.conversation.findMany({
        where: { tenantId, assignedToId: null, status: { in: [ConversationStatus.OPEN, ConversationStatus.REQUESTED] } },
        orderBy: { createdAt: 'asc' },
        take: 5,
        select: { id: true, createdAt: true, status: true, contact: CONTACT_SELECT },
      }),
    ]);
    return { count, items };
  }

  private async getWindowClosingSoon(tenantId: string, agentScopeId?: string) {
    const activeConvs = await this.prisma.conversation.findMany({
      where: { tenantId, status: { notIn: ['RESOLVED'] }, ...(agentScopeId && { assignedToId: agentScopeId }) },
      select: { id: true, contact: CONTACT_SELECT },
      take: 500, // guardrail against pathological tenants; the 24h window itself bounds relevance
    });
    if (activeConvs.length === 0) return { count: 0, items: [] as unknown[] };

    const lastInbounds = await this.prisma.message.findMany({
      where: { conversationId: { in: activeConvs.map((c) => c.id) }, direction: 'INBOUND' },
      select: { conversationId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      distinct: ['conversationId'],
    });

    const now = new Date();
    const convMap = new Map(activeConvs.map((c) => [c.id, c]));
    const closing = lastInbounds
      .filter((m) => isWindowClosingSoon(m.createdAt, now))
      .map((m) => ({
        conversationId: m.conversationId,
        contact: convMap.get(m.conversationId)?.contact,
        hoursRemaining: Math.round(hoursRemainingInWindow(m.createdAt, now) * 10) / 10,
      }))
      .sort((a, b) => a.hoursRemaining - b.hoursRemaining);

    return { count: closing.length, items: closing.slice(0, 5) };
  }

  /**
   * Uses the existing SLA infrastructure (Conversation.slaDeadline/slaBreached, set from the
   * hardcoded SLA_MINUTES constants in conversations.service.ts: 15min for a new request, 2h
   * once an agent has intervened) -- there is no tenant-configurable SLA setting today.
   */
  private async getSlaBreaching(tenantId: string, agentScopeId?: string) {
    const where: Prisma.ConversationWhereInput = {
      tenantId,
      status: { in: [ConversationStatus.REQUESTED, ConversationStatus.INTERVENED] },
      OR: [{ slaBreached: true }, { slaDeadline: { lt: new Date() } }],
      ...(agentScopeId && { assignedToId: agentScopeId }),
    };
    const [count, items] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where, orderBy: { slaDeadline: 'asc' }, take: 5,
        select: { id: true, status: true, slaDeadline: true, contact: CONTACT_SELECT },
      }),
    ]);
    return { count, items };
  }

  // ─── Today at a glance ───────────────────────────────────────────────────

  private async getToday(tenantId: string, agentScopeId: string | undefined, admin: boolean, timezone: string) {
    const cacheKey = `${tenantId}:${agentScopeId ?? 'tenant'}`;
    const cached = this.todayCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const todayStr = toTenantDateString(new Date(), timezone);
    const yesterdayStr = toTenantDateString(new Date(Date.now() - 24 * 60 * 60 * 1000), timezone);
    const { start: todayStart, end: todayEnd } = getTenantDayBoundaries(todayStr, timezone);
    const { start: yStart, end: yEnd } = getTenantDayBoundaries(yesterdayStr, timezone);

    const convWhere = (start: Date, end: Date) => ({
      tenantId, createdAt: { gte: start, lt: end }, ...(agentScopeId && { assignedToId: agentScopeId }),
    });

    const [
      newToday, newYesterday, sent, received, resolvedToday, medianFirstResponseSeconds, revenue,
    ] = await Promise.all([
      this.prisma.conversation.count({ where: convWhere(todayStart, todayEnd) }),
      this.prisma.conversation.count({ where: convWhere(yStart, yEnd) }),
      this.prisma.message.count({ where: { tenantId, direction: 'OUTBOUND', createdAt: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'INBOUND', createdAt: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.conversation.count({
        where: { tenantId, resolvedAt: { gte: todayStart, lt: todayEnd }, ...(agentScopeId && { assignedToId: agentScopeId }) },
      }),
      this.getMedianFirstResponseSeconds(tenantId, todayStart, todayEnd, agentScopeId),
      admin ? this.getRevenueToday(tenantId, todayStart, todayEnd) : Promise.resolve(null),
    ]);

    const changePct = newYesterday === 0
      ? (newToday === 0 ? 0 : null)
      : Math.round(((newToday - newYesterday) / newYesterday) * 1000) / 10;

    const data = {
      newConversations: { today: newToday, yesterday: newYesterday, changePct },
      messagesSent: sent,
      messagesReceived: received,
      medianFirstResponseSeconds,
      resolvedToday,
      revenue,
    };

    this.todayCache.set(cacheKey, { data, expiresAt: Date.now() + STAT_CACHE_TTL_MS });
    return data;
  }

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
      WHERE (${agentId ?? null}::text IS NULL OR out_msg.sender_id = ${agentId ?? null})
    `;
    const value = rows[0]?.median_seconds;
    return value != null ? Math.round(Number(value)) : null;
  }

  /** Payments are the tenant's own VerzChat subscription billing -- see the analytics revenue endpoint for the same framing. Broken down by currency since gateways settle in different ones (Stripe=USD, Paystack=GHS) rather than force-converting. */
  private async getRevenueToday(tenantId: string, start: Date, end: Date) {
    const rows = await this.prisma.payment.groupBy({
      by: ['currency'],
      where: { tenantId, status: 'SUCCEEDED', verifiedAt: { gte: start, lt: end } },
      _sum: { amount: true },
      _count: { id: true },
    });
    return rows.map((r) => ({ currency: r.currency, amount: r._sum.amount ?? 0, count: r._count.id }));
  }

  // ─── WhatsApp health ─────────────────────────────────────────────────────

  private async getHealth(tenantId: string) {
    const numbers = await this.prisma.whatsAppNumber.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, label: true, qualityRating: true, messagingLimitTier: true, qualitySyncedAt: true },
    });

    const recentRejection = await this.prisma.template.findFirst({
      where: { tenantId, status: 'REJECTED', updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, rejectionReason: true },
    });

    const nonGreen = numbers.some((n) => n.qualityRating && n.qualityRating !== 'GREEN');
    return {
      numbers,
      numbersConfigured: numbers.length > 0,
      warning: nonGreen || !!recentRejection,
      recentRejection,
    };
  }

  // ─── Activity feed (polled, not push -- see PR description) ─────────────

  private async getActivity(tenantId: string) {
    const [events, payments, campaignsCompleted, templateChanges] = await Promise.all([
      this.prisma.conversationEvent.findMany({
        where: { tenantId, type: { in: ['OPENED', 'RESOLVED'] } },
        orderBy: { createdAt: 'desc' }, take: 10,
        select: { id: true, type: true, createdAt: true, conversationId: true, actorId: true },
      }),
      this.prisma.payment.findMany({
        where: { tenantId, status: 'SUCCEEDED' },
        orderBy: { verifiedAt: 'desc' }, take: 5,
        select: { id: true, amount: true, currency: true, gateway: true, verifiedAt: true },
      }),
      this.prisma.campaign.findMany({
        where: { tenantId, status: 'COMPLETED', completedAt: { not: null } },
        orderBy: { completedAt: 'desc' }, take: 5,
        select: { id: true, name: true, completedAt: true, sentCount: true },
      }),
      this.prisma.template.findMany({
        where: { tenantId, status: { in: [TemplateStatus.APPROVED, TemplateStatus.REJECTED] } },
        orderBy: { updatedAt: 'desc' }, take: 5,
        select: { id: true, name: true, status: true, updatedAt: true },
      }),
    ]);

    type ActivityItem = { id: string; type: string; timestamp: Date; data: Record<string, unknown> };
    const items: ActivityItem[] = [
      ...events.map((e) => ({ id: e.id, type: e.type === 'OPENED' ? 'conversation_opened' : 'conversation_resolved', timestamp: e.createdAt, data: { conversationId: e.conversationId } })),
      ...payments.map((p) => ({ id: p.id, type: 'payment_received', timestamp: p.verifiedAt!, data: { amount: p.amount, currency: p.currency, gateway: p.gateway } })),
      ...campaignsCompleted.map((c) => ({ id: c.id, type: 'campaign_completed', timestamp: c.completedAt!, data: { campaignId: c.id, name: c.name, sentCount: c.sentCount } })),
      ...templateChanges.map((t) => ({ id: t.id, type: t.status === 'APPROVED' ? 'template_approved' : 'template_rejected', timestamp: t.updatedAt, data: { templateId: t.id, name: t.name } })),
    ];

    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10);
  }

  // ─── Recent campaigns ────────────────────────────────────────────────────

  private async getRecentCampaigns(tenantId: string) {
    return this.prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        id: true, name: true, status: true,
        totalRecipients: true, sentCount: true, deliveredCount: true, readCount: true,
      },
    });
  }

  // ─── Setup checklist (admin only, new tenants only) ──────────────────────

  private async getSetupChecklist(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { onboardingCompleted: true, phoneNumberId: true, wabaId: true, accessToken: true },
    });
    if (!tenant || tenant.onboardingCompleted) return null;

    const [whatsAppNumberCount, approvedTemplateCount, userCount, subscription, campaignCount] = await Promise.all([
      this.prisma.whatsAppNumber.count({ where: { tenantId, isActive: true } }),
      this.prisma.template.count({ where: { tenantId, status: 'APPROVED' } }),
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.subscription.findUnique({ where: { tenantId }, select: { status: true } }),
      this.prisma.campaign.count({ where: { tenantId, status: { in: [CampaignStatus.RUNNING, CampaignStatus.COMPLETED] } } }),
    ]);

    const whatsappConnected = whatsAppNumberCount > 0 || !!(tenant.phoneNumberId && tenant.wabaId && tenant.accessToken);

    const items = [
      { key: 'whatsapp_connected', label: 'Connect your WhatsApp Business number', done: whatsappConnected, href: '/channels' },
      { key: 'template_approved', label: 'Get your first template approved', done: approvedTemplateCount > 0, href: '/templates' },
      { key: 'teammate_invited', label: 'Invite a teammate', done: userCount > 1, href: '/manage' },
      { key: 'payment_configured', label: 'Set up billing', done: subscription?.status === 'ACTIVE', href: '/billing' },
      { key: 'first_broadcast', label: 'Send your first broadcast', done: campaignCount > 0, href: '/campaigns' },
    ];

    return {
      items,
      completedCount: items.filter((i) => i.done).length,
      totalCount: items.length,
    };
  }
}
