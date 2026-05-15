import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import { ListWorkspacesDto, ListUsersDto } from '../dto/workspace-action.dto';

@Injectable()
export class PlatformAdminService {
  constructor(
    private prisma: PrismaService,
    private auditService: PlatformAuditService,
  ) {}

  // ── Global Dashboard Stats ───────────────────────────────────────────────

  async getGlobalStats() {
    const [
      totalWorkspaces,
      activeWorkspaces,
      suspendedWorkspaces,
      totalUsers,
      activeUsers,
      totalConversations,
      openConversations,
      totalMessages,
      totalChannels,
      activeChannels,
      totalCampaigns,
      totalContacts,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { isActive: true } }),
      this.prisma.tenant.count({ where: { isActive: false } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.conversation.count(),
      this.prisma.conversation.count({ where: { status: 'OPEN' } }),
      this.prisma.message.count(),
      this.prisma.channel.count(),
      this.prisma.channel.count({ where: { isActive: true } }),
      this.prisma.campaign.count(),
      this.prisma.contact.count(),
    ]);

    // Workspace growth (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const newWorkspacesMonth = await this.prisma.tenant.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    });

    // Message volume today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const messagesToday = await this.prisma.message.count({
      where: { createdAt: { gte: today } },
    });

    // Campaigns sent/delivered
    const campaignStats = await this.prisma.campaign.aggregate({
      _sum: { sentCount: true, deliveredCount: true, readCount: true, failedCount: true },
    });

    return {
      workspaces: { total: totalWorkspaces, active: activeWorkspaces, suspended: suspendedWorkspaces, newThisMonth: newWorkspacesMonth },
      users: { total: totalUsers, active: activeUsers },
      conversations: { total: totalConversations, open: openConversations },
      messages: { total: totalMessages, today: messagesToday },
      channels: { total: totalChannels, active: activeChannels },
      campaigns: {
        total: totalCampaigns,
        sent: campaignStats._sum.sentCount ?? 0,
        delivered: campaignStats._sum.deliveredCount ?? 0,
        read: campaignStats._sum.readCount ?? 0,
        failed: campaignStats._sum.failedCount ?? 0,
      },
      contacts: { total: totalContacts },
    };
  }

  // ── Workspace Management ─────────────────────────────────────────────────

  async listWorkspaces(query: ListWorkspacesDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.search) {
      where['OR'] = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
        { billingEmail: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.plan) where['plan'] = query.plan;
    if (query.status === 'active') where['isActive'] = true;
    if (query.status === 'suspended') where['isActive'] = false;

    const [workspaces, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, name: true, slug: true, plan: true, isActive: true,
          billingEmail: true, country: true, industry: true,
          createdAt: true, updatedAt: true,
          _count: {
            select: { users: true, conversations: true, messages: true, channels: true, contacts: true },
          },
          workspaceMembers: {
            where: { role: 'OWNER' },
            take: 1,
            select: { user: { select: { id: true, email: true, name: true } } },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data: workspaces.map((ws) => ({
        ...ws,
        owner: ws.workspaceMembers[0]?.user ?? null,
        workspaceMembers: undefined,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async getWorkspace(id: string) {
    const workspace = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        settings: true,
        channels: { select: { id: true, type: true, name: true, isActive: true, createdAt: true } },
        workspaceMembers: {
          include: { user: { select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, lastSeenAt: true } } },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: { users: true, conversations: true, messages: true, contacts: true, campaigns: true, templates: true },
        },
      },
    });

    if (!workspace) throw new NotFoundException(`Workspace ${id} not found`);

    // Fetch last 7 days message volume
    const days7ago = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentMessages = await this.prisma.message.count({
      where: { tenantId: id, createdAt: { gte: days7ago } },
    });

    return { ...workspace, recentMessages7d: recentMessages };
  }

  async suspendWorkspace(id: string, adminId: string, reason?: string) {
    const ws = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!ws) throw new NotFoundException(`Workspace ${id} not found`);

    await this.prisma.tenant.update({ where: { id }, data: { isActive: false } });
    await this.auditService.log({
      adminId,
      action: 'WORKSPACE_SUSPENDED',
      resourceType: 'WORKSPACE',
      resourceId: id,
      metadata: { name: ws.name, reason },
    });

    return { success: true };
  }

  async reactivateWorkspace(id: string, adminId: string) {
    const ws = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!ws) throw new NotFoundException(`Workspace ${id} not found`);

    await this.prisma.tenant.update({ where: { id }, data: { isActive: true } });
    await this.auditService.log({
      adminId,
      action: 'WORKSPACE_REACTIVATED',
      resourceType: 'WORKSPACE',
      resourceId: id,
      metadata: { name: ws.name },
    });

    return { success: true };
  }

  async deleteWorkspace(id: string, adminId: string) {
    const ws = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!ws) throw new NotFoundException(`Workspace ${id} not found`);

    await this.prisma.tenant.delete({ where: { id } });
    await this.auditService.log({
      adminId,
      action: 'WORKSPACE_DELETED',
      resourceType: 'WORKSPACE',
      resourceId: id,
      metadata: { name: ws.name },
    });

    return { success: true };
  }

  async updateWorkspacePlan(id: string, plan: string, adminId: string) {
    const ws = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true, plan: true } });
    if (!ws) throw new NotFoundException(`Workspace ${id} not found`);

    await this.prisma.tenant.update({ where: { id }, data: { plan } });
    await this.auditService.log({
      adminId,
      action: 'WORKSPACE_PLAN_CHANGED',
      resourceType: 'WORKSPACE',
      resourceId: id,
      metadata: { name: ws.name, fromPlan: ws.plan, toPlan: plan },
    });

    return { success: true };
  }

  // ── User Management ──────────────────────────────────────────────────────

  async listUsers(query: ListUsersDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.search) {
      where['OR'] = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.workspaceId) where['tenantId'] = query.workspaceId;
    if (query.status === 'active') where['isActive'] = true;
    if (query.status === 'suspended') where['isActive'] = false;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, email: true, name: true, role: true, isActive: true,
          lastLoginAt: true, lastSeenAt: true, createdAt: true,
          tenant: { select: { id: true, name: true, plan: true, isActive: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data: users, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async suspendUser(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    await this.prisma.user.update({ where: { id: userId }, data: { isActive: false, refreshToken: null } });
    await this.auditService.log({
      adminId,
      action: 'USER_SUSPENDED',
      resourceType: 'USER',
      resourceId: userId,
      metadata: { email: user.email, name: user.name },
    });

    return { success: true };
  }

  async reactivateUser(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    await this.prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    await this.auditService.log({
      adminId, action: 'USER_REACTIVATED', resourceType: 'USER',
      resourceId: userId, metadata: { email: user.email },
    });

    return { success: true };
  }

  async forceLogoutUser(userId: string, adminId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { refreshToken: null } });
    await this.auditService.log({
      adminId, action: 'USER_FORCE_LOGOUT', resourceType: 'USER', resourceId: userId,
    });

    return { success: true };
  }

  // ── Channel Monitoring ───────────────────────────────────────────────────

  async listChannels(query: { workspaceId?: string; type?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.workspaceId) where['tenantId'] = query.workspaceId;
    if (query.type) where['type'] = query.type;

    const [channels, total] = await Promise.all([
      this.prisma.channel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { tenant: { select: { id: true, name: true, plan: true } } },
      }),
      this.prisma.channel.count({ where }),
    ]);

    return { data: channels, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  async getGrowthAnalytics(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Daily workspace registrations
    const workspaceGrowth = await this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT DATE_TRUNC('day', created_at)::date::text AS date, COUNT(*)::bigint AS count
      FROM tenants
      WHERE created_at >= ${startDate}
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date ASC
    `;

    // Daily message volume
    const messageVolume = await this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT DATE_TRUNC('day', created_at)::date::text AS date, COUNT(*)::bigint AS count
      FROM messages
      WHERE created_at >= ${startDate}
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date ASC
    `;

    // Daily active users (logged in)
    const activeUsers = await this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT DATE_TRUNC('day', last_login_at)::date::text AS date, COUNT(DISTINCT id)::bigint AS count
      FROM users
      WHERE last_login_at >= ${startDate}
      GROUP BY DATE_TRUNC('day', last_login_at)
      ORDER BY date ASC
    `;

    // Plan distribution
    const planDistribution = await this.prisma.tenant.groupBy({
      by: ['plan'],
      _count: { id: true },
    });

    // Channel type distribution
    const channelDistribution = await this.prisma.channel.groupBy({
      by: ['type'],
      _count: { id: true },
      where: { isActive: true },
    });

    return {
      workspaceGrowth: workspaceGrowth.map((r) => ({ date: r.date, count: Number(r.count) })),
      messageVolume: messageVolume.map((r) => ({ date: r.date, count: Number(r.count) })),
      activeUsers: activeUsers.map((r) => ({ date: r.date, count: Number(r.count) })),
      planDistribution: planDistribution.map((r) => ({ plan: r.plan, count: r._count.id })),
      channelDistribution: channelDistribution.map((r) => ({ type: r.type, count: r._count.id })),
    };
  }

  // ── Platform Settings ────────────────────────────────────────────────────

  async getSettings() {
    const settings = await this.prisma.platformSettings.findMany({ orderBy: { key: 'asc' } });
    return settings;
  }

  async upsertSetting(key: string, value: unknown, description?: string, adminId?: string) {
    const setting = await this.prisma.platformSettings.upsert({
      where: { key },
      update: { value: value as never, description: description ?? undefined, updatedBy: adminId ?? null },
      create: { key, value: value as never, description: description ?? null, updatedBy: adminId ?? null },
    });

    if (adminId) {
      await this.auditService.log({
        adminId, action: 'SETTING_UPDATED', resourceType: 'SETTING', resourceId: key,
        metadata: { key, value },
      });
    }

    return setting;
  }
}
