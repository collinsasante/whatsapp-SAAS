import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://backend:3001';
const INTERNAL_SECRET = process.env['INTERNAL_SECRET'] ?? '';

export class BillingCronWorker {
  private timer?: ReturnType<typeof setInterval>;

  constructor(private prisma: PrismaClient) {}

  start() {
    // Run immediately on startup, then every hour
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 60 * 60 * 1000);
    console.log('Billing cron worker started');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      await this.downgradeExpiredSubscriptions();
      await this.notifyLowCredits();
    } catch (err) {
      console.error('Billing cron tick error:', (err as Error).message);
    }
  }

  private async downgradeExpiredSubscriptions() {
    const now = new Date();

    // Find subscriptions that have passed their period end and are ACTIVE (non-free paid plans)
    const expired = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        currentPeriodEnd: { lte: now },
        plan: { monthlyPrice: { gt: 0 } },
      },
      include: { plan: true },
    });

    const freePlan = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
    if (!freePlan) return;

    for (const sub of expired) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          planId: freePlan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        },
      });

      // Notify admins via backend
      await axios.post(
        `${BACKEND_URL}/manage/settings/subscription-downgraded`,
        { tenantId: sub.tenantId },
        { headers: { 'x-internal-secret': INTERNAL_SECRET }, timeout: 8000 },
      ).catch(() => null);

      console.log(`Downgraded tenant ${sub.tenantId} from ${sub.plan.slug} to free (expired)`);
    }

    // Handle expired trials (existing logic)
    const expiredTrials = await this.prisma.subscription.findMany({
      where: { status: 'TRIAL', trialEndsAt: { lte: now } },
      include: { plan: true },
    });

    for (const sub of expiredTrials) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          planId: freePlan.id,
          currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        },
      });
      console.log(`Trial expired for tenant ${sub.tenantId}`);
    }
  }

  private async notifyLowCredits() {
    // Warn tenants with AI approved but ≤ 20 credits left — in-app notification only via Prisma
    const lowCreditTenants = await this.prisma.tenantSettings.findMany({
      where: {
        aiEnabled: true,
        aiTrialApprovedAt: { not: null },
        tenant: { aiCredits: { lte: 20, gt: 0 } },
      },
      include: {
        tenant: {
          include: {
            users: {
              where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
              select: { id: true },
            },
          },
        },
      },
    });

    for (const record of lowCreditTenants) {
      const { tenantId, tenant } = record as typeof record & { tenant: { users: { id: string }[]; aiCredits: number } };
      for (const admin of tenant.users) {
        await this.prisma.notification.create({
          data: {
            tenantId,
            userId: admin.id,
            type: 'SYSTEM',
            title: 'AI credits running low',
            body: `Only ${(tenant as { aiCredits: number }).aiCredits} credits remaining. Top up to keep VerzAI running.`,
            link: '/billing',
          },
        }).catch(() => null);
      }
    }
  }
}
