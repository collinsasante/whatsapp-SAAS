import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const PLANS: Record<string, {
  name: string; price: number; messagesPerMonth: number;
  contacts: number; agents: number; channels: number; templates: number;
  features: string[];
}> = {
  free: {
    name: 'Free', price: 0,
    messagesPerMonth: 1000, contacts: 500, agents: 1, channels: 1, templates: 5,
    features: ['1 WhatsApp Channel', '500 Contacts', '1,000 Messages/mo', '1 Agent', '5 Templates'],
  },
  starter: {
    name: 'Starter', price: 29,
    messagesPerMonth: 5000, contacts: 5000, agents: 3, channels: 2, templates: 20,
    features: ['2 WhatsApp Channels', '5,000 Contacts', '5,000 Messages/mo', '3 Agents', '20 Templates', 'CSV Import'],
  },
  growth: {
    name: 'Growth', price: 79,
    messagesPerMonth: 25000, contacts: 50000, agents: 10, channels: 5, templates: -1,
    features: ['5 Channels', '50,000 Contacts', '25,000 Messages/mo', '10 Agents', 'Unlimited Templates', 'Campaigns', 'Automation'],
  },
  enterprise: {
    name: 'Enterprise', price: -1,
    messagesPerMonth: -1, contacts: -1, agents: -1, channels: -1, templates: -1,
    features: ['Unlimited Channels', 'Unlimited Contacts', 'Unlimited Messages', 'Unlimited Agents', 'Priority Support', 'Custom Integrations', 'Dedicated Manager'],
  },
};

@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService) {}

  async getStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, planStartedAt: true, planExpiresAt: true, billingEmail: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const plan = PLANS[tenant.plan] ?? PLANS['free'];
    const now = new Date();
    const nextRenewal = tenant.planExpiresAt ?? new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      currentPlan: tenant.plan,
      planDetails: plan,
      planStartedAt: tenant.planStartedAt,
      planExpiresAt: tenant.planExpiresAt,
      nextRenewal,
      billingEmail: tenant.billingEmail,
      plans: PLANS,
    };
  }

  async getUsage(tenantId: string) {
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [messagesSent, totalContacts, totalAgents, totalTemplates, totalChannels, totalCampaigns] =
      await Promise.all([
        this.prisma.message.count({
          where: { tenantId, direction: 'OUTBOUND', createdAt: { gte: cycleStart } },
        }),
        this.prisma.contact.count({ where: { tenantId } }),
        this.prisma.user.count({ where: { tenantId, isActive: true } }),
        this.prisma.template.count({ where: { tenantId } }),
        this.prisma.channel.count({ where: { tenantId, isActive: true } }),
        this.prisma.campaign.count({ where: { tenantId } }),
      ]);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
    const plan = PLANS[tenant?.plan ?? 'free'] ?? PLANS['free'];

    return {
      cycleStart,
      messagesSent,
      totalContacts,
      totalAgents,
      totalTemplates,
      totalChannels,
      totalCampaigns,
      limits: {
        messagesPerMonth: plan.messagesPerMonth,
        contacts: plan.contacts,
        agents: plan.agents,
        channels: plan.channels,
        templates: plan.templates,
      },
    };
  }

  async getInvoices(tenantId: string) {
    return this.prisma.billingInvoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
  }

  async upgradePlan(tenantId: string, plan: string) {
    if (!PLANS[plan]) throw new NotFoundException('Invalid plan');

    const planDetails = PLANS[plan];
    const now = new Date();
    const expiresAt = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { plan, planStartedAt: now, planExpiresAt: expiresAt },
    });

    if (planDetails.price > 0) {
      const period = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      await this.prisma.billingInvoice.create({
        data: {
          tenantId,
          amount: planDetails.price,
          description: `${planDetails.name} Plan — Monthly Subscription`,
          period,
          status: 'PAID',
          paidAt: now,
        },
      });
    }

    return { success: true, plan, expiresAt };
  }

  async updateBillingEmail(tenantId: string, billingEmail: string) {
    return this.prisma.tenant.update({ where: { id: tenantId }, data: { billingEmail } });
  }
}
