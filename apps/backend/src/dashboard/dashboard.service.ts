import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOverview(tenantId: string) {
    const now = new Date();
    const startOf30Days = new Date(now);
    startOf30Days.setDate(startOf30Days.getDate() - 30);

    const [
      totalContacts,
      totalConversations,
      openConversations,
      resolvedConversations,
      pendingConversations,
      assignedConversations,
      unassignedConversations,
      totalMessages,
      totalCampaigns,
      tenant,
    ] = await Promise.all([
      this.prisma.contact.count({ where: { tenantId } }),
      this.prisma.conversation.count({ where: { tenantId } }),
      this.prisma.conversation.count({ where: { tenantId, status: 'OPEN' } }),
      this.prisma.conversation.count({ where: { tenantId, status: 'RESOLVED' } }),
      this.prisma.conversation.count({ where: { tenantId, status: 'REQUESTED' } }),
      this.prisma.conversation.count({ where: { tenantId, assignedToId: { not: null } } }),
      this.prisma.conversation.count({ where: { tenantId, assignedToId: null } }),
      this.prisma.message.count({ where: { tenantId } }),
      this.prisma.campaign.count({ where: { tenantId } }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { settings: true },
      }),
    ]);

    return {
      contacts: {
        total: totalContacts,
        open: openConversations,
        assigned: assignedConversations,
        unassigned: unassignedConversations,
      },
      conversations: {
        total: totalConversations,
        open: openConversations,
        resolved: resolvedConversations,
        pending: pendingConversations,
      },
      messages: totalMessages,
      campaigns: totalCampaigns,
      business: {
        name: tenant?.settings?.businessName ?? tenant?.name ?? '',
        phone: tenant?.settings?.businessPhone ?? '',
        email: tenant?.settings?.businessEmail ?? '',
        address: tenant?.settings?.businessAddress ?? '',
        website: tenant?.settings?.businessWebsite ?? '',
        description: tenant?.settings?.businessDescription ?? '',
        wabaId: tenant?.wabaId ?? null,
        phoneNumberId: tenant?.phoneNumberId ?? null,
        plan: tenant?.plan ?? 'starter',
      },
    };
  }

  async getTeamStats(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        role: true,
        lastSeenAt: true,
        _count: {
          select: { assignedConversations: true },
        },
      },
    });

    const stats = await Promise.all(
      users.map(async (user) => {
        const [activeConvCount, resolvedToday, avgResponseMs] = await Promise.all([
          this.prisma.conversation.count({
            where: { tenantId, assignedToId: user.id, status: 'OPEN' },
          }),
          this.prisma.conversation.count({
            where: {
              tenantId,
              assignedToId: user.id,
              status: 'RESOLVED',
              updatedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
            },
          }),
          // Approximate response time: avg time from last inbound to first outbound in last 7 days
          this.prisma.$queryRaw<{ avg_ms: bigint | null }[]>`
            SELECT AVG(EXTRACT(EPOCH FROM (out_msg.created_at - in_msg.created_at)) * 1000)::bigint as avg_ms
            FROM messages in_msg
            JOIN LATERAL (
              SELECT created_at FROM messages
              WHERE conversation_id = in_msg.conversation_id
                AND direction = 'OUTBOUND'
                AND sender_id = ${user.id}
                AND created_at > in_msg.created_at
              ORDER BY created_at ASC
              LIMIT 1
            ) out_msg ON true
            WHERE in_msg.tenant_id = ${tenantId}
              AND in_msg.direction = 'INBOUND'
              AND in_msg.created_at >= NOW() - INTERVAL '7 days'
          `.catch(() => [{ avg_ms: null }]),
        ]);

        const avgMs = Array.isArray(avgResponseMs) && avgResponseMs[0]?.avg_ms
          ? Number(avgResponseMs[0].avg_ms)
          : null;

        const isOnline = user.lastSeenAt
          ? Date.now() - new Date(user.lastSeenAt).getTime() < 5 * 60 * 1000
          : false;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          role: user.role,
          isOnline,
          lastSeenAt: user.lastSeenAt,
          assignedConversations: user._count.assignedConversations,
          activeConversations: activeConvCount,
          resolvedToday,
          avgResponseMs: avgMs,
        };
      }),
    );

    return stats;
  }

  async getConversationTrend(tenantId: string, days = 14) {
    const result: { date: string; opened: number; resolved: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const start = new Date(date.setHours(0, 0, 0, 0));
      const end = new Date(date.setHours(23, 59, 59, 999));

      const [opened, resolved] = await Promise.all([
        this.prisma.conversation.count({
          where: { tenantId, createdAt: { gte: start, lte: end } },
        }),
        this.prisma.conversation.count({
          where: { tenantId, status: 'RESOLVED', updatedAt: { gte: start, lte: end } },
        }),
      ]);

      result.push({
        date: start.toISOString().split('T')[0],
        opened,
        resolved,
      });
    }

    return result;
  }

  async getConversationStats(tenantId: string, from: Date, to: Date) {
    const [opened, closed] = await Promise.all([
      this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: from, lte: to } } }),
      this.prisma.conversation.count({ where: { tenantId, status: 'RESOLVED', updatedAt: { gte: from, lte: to } } }),
    ]);
    return { opened, closed };
  }

  async getWhatsAppStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        phoneNumberId: true,
        wabaId: true,
        accessToken: true,
        isActive: true,
        webhookVerifyToken: true,
      },
    });

    const isConfigured = !!(tenant?.phoneNumberId && tenant?.wabaId && tenant?.accessToken);

    return {
      isConfigured,
      isConnected: isConfigured && !!tenant?.isActive,
      phoneNumberId: tenant?.phoneNumberId ?? null,
      wabaId: tenant?.wabaId ?? null,
      webhookActive: isConfigured,
      qualityRating: 'GREEN',
      messagingLimit: 'TIER_1K',
      verificationStatus: isConfigured ? 'VERIFIED' : 'NOT_VERIFIED',
    };
  }
}
