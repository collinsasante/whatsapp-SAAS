import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto, UpdatePlanDto, UpdateWorkspaceDto } from './dto/platform-admin.dto';

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

  async getWorkspaces(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where = search
      ? { OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { billingEmail: { contains: search, mode: 'insensitive' as const } },
          { users: { some: { email: { contains: search, mode: 'insensitive' as const } } } },
        ] }
      : {};

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, isActive: true, billingEmail: true, createdAt: true, aiCredits: true,
          _count: { select: { users: true, conversations: true } },
          subscription: {
            select: {
              status: true, cycle: true, currentPeriodEnd: true,
              plan: { select: { name: true, monthlyPrice: true } },
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { tenants, total, page, limit };
  }

  async getWorkspace(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, conversations: true, messages: true, contacts: true } },
        subscription: { include: { plan: true } },
        invoices: {
          orderBy: { createdAt: 'desc' }, take: 10,
          select: { id: true, invoiceNumber: true, status: true, total: true, currency: true, createdAt: true, paidAt: true },
        },
        creditPurchases: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return tenant;
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

  async getPendingBilling() {
    const [invoices, creditPurchases] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true, billingEmail: true } } },
      }),
      this.prisma.creditPurchase.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true, billingEmail: true } } },
      }),
    ]);
    return { invoices, creditPurchases };
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

  async activateSubscription(reference: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { gatewayInvoiceId: reference } });
    if (!invoice) throw new NotFoundException(`Invoice not found for reference ${reference}`);
    if (invoice.status === 'PAID') return { alreadyActivated: true };

    const meta = invoice.metadata as { planId?: string; planSlug?: string; cycle?: string } | null;
    const plan = meta?.planId
      ? await this.prisma.plan.findUnique({ where: { id: meta.planId } })
      : meta?.planSlug
        ? await this.prisma.plan.findUnique({ where: { slug: meta.planSlug } })
        : null;
    if (!plan) throw new NotFoundException('Cannot resolve plan from invoice');

    const now = new Date();
    const cycle = meta?.cycle ?? 'MONTHLY';
    const periodEnd = cycle === 'YEARLY'
      ? new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    await this.prisma.$transaction([
      this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: now } }),
      this.prisma.subscription.upsert({
        where: { tenantId: invoice.tenantId },
        create: {
          tenantId: invoice.tenantId, planId: plan.id,
          status: 'ACTIVE', cycle: cycle as 'MONTHLY' | 'YEARLY',
          currentPeriodStart: now, currentPeriodEnd: periodEnd,
        },
        update: {
          planId: plan.id, status: 'ACTIVE', cycle: cycle as 'MONTHLY' | 'YEARLY',
          currentPeriodStart: now, currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false, canceledAt: null,
        },
      }),
    ]);

    return { activated: true, tenantId: invoice.tenantId, plan: plan.name };
  }

  async activateCredits(reference: string) {
    const purchase = await this.prisma.creditPurchase.findUnique({ where: { paystackRef: reference } });
    if (!purchase) throw new NotFoundException(`Credit purchase not found for reference ${reference}`);
    if (purchase.status === 'SUCCEEDED') return { alreadyActivated: true };

    await Promise.all([
      this.prisma.creditPurchase.update({ where: { id: purchase.id }, data: { status: 'SUCCEEDED' } }),
      this.prisma.tenant.update({ where: { id: purchase.tenantId }, data: { aiCredits: { increment: purchase.credits } } }),
    ]);

    const updated = await this.prisma.tenant.findUnique({ where: { id: purchase.tenantId }, select: { aiCredits: true } });
    return { activated: true, creditsAdded: purchase.credits, newBalance: updated?.aiCredits ?? 0 };
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

  async declineInvoice(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'OPEN') return { alreadyHandled: true };
    await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } });
    return { declined: true };
  }

  async declineCredits(purchaseId: string) {
    const purchase = await this.prisma.creditPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) throw new NotFoundException('Credit purchase not found');
    if (purchase.status !== 'PENDING') return { alreadyHandled: true };
    await this.prisma.creditPurchase.update({ where: { id: purchaseId }, data: { status: 'FAILED' } });
    return { declined: true };
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
