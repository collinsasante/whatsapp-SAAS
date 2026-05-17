import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  currentPeriod(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  async getLiveUsage(tenantId: string) {
    const { start } = this.currentPeriod();

    const [
      messagesSent,
      messagesReceived,
      conversationsOpened,
      campaignsSent,
      activeAgents,
      activeChannels,
      totalContacts,
      totalTemplates,
    ] = await Promise.all([
      this.prisma.message.count({ where: { tenantId, direction: 'OUTBOUND', createdAt: { gte: start } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'INBOUND', createdAt: { gte: start } } }),
      this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: start } } }),
      this.prisma.campaign.count({ where: { tenantId, createdAt: { gte: start } } }),
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.channel.count({ where: { tenantId, isActive: true } }),
      this.prisma.contact.count({ where: { tenantId } }),
      this.prisma.template.count({ where: { tenantId } }),
    ]);

    return {
      periodStart: start,
      messagesSent,
      messagesReceived,
      conversationsOpened,
      campaignsSent,
      aiCreditsUsed: 0,
      activeAgents,
      activeChannels,
      totalContacts,
      totalTemplates,
    };
  }

  async getUsageWithLimits(tenantId: string) {
    const [usage, tenant] = await Promise.all([
      this.getLiveUsage(tenantId),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { subscription: { include: { plan: true } } },
      }),
    ]);

    const plan = tenant?.subscription?.plan;
    const limits = plan
      ? {
          maxAgents: plan.limMaxAgents,
          maxChannels: plan.limMaxChannels,
          maxContacts: plan.limMaxContacts,
          maxTemplates: plan.limMaxTemplates,
          messagesPerMonth: plan.limMessagesPerMonth,
          maxCampaigns: plan.limMaxCampaigns,
          aiCreditsPerMonth: plan.limAiCreditsPerMonth,
          storageGb: plan.limStorageGb,
        }
      : {
          maxAgents: 1,
          maxChannels: 1,
          maxContacts: 500,
          maxTemplates: 5,
          messagesPerMonth: 1000,
          maxCampaigns: 0,
          aiCreditsPerMonth: 0,
          storageGb: 1,
        };

    return { usage, limits };
  }

  async snapshotUsage(tenantId: string) {
    const { start, end } = this.currentPeriod();
    const live = await this.getLiveUsage(tenantId);

    return this.prisma.workspaceUsage.upsert({
      where: { tenantId_periodStart: { tenantId, periodStart: start } },
      update: {
        messagesSent: live.messagesSent,
        messagesReceived: live.messagesReceived,
        conversationsOpened: live.conversationsOpened,
        campaignsSent: live.campaignsSent,
        activeAgents: live.activeAgents,
        activeChannels: live.activeChannels,
      },
      create: {
        tenantId,
        periodStart: start,
        periodEnd: end,
        messagesSent: live.messagesSent,
        messagesReceived: live.messagesReceived,
        conversationsOpened: live.conversationsOpened,
        campaignsSent: live.campaignsSent,
        activeAgents: live.activeAgents,
        activeChannels: live.activeChannels,
      },
    });
  }

  async getHistoricalUsage(tenantId: string, months = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    return this.prisma.workspaceUsage.findMany({
      where: { tenantId, periodStart: { gte: since } },
      orderBy: { periodStart: 'asc' },
    });
  }
}
