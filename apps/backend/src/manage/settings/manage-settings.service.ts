import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EmailService } from '../../common/email.service';
import { QueueName, AiTrialExpireJob } from '@whatsapp-platform/shared-types';
import { Prisma } from '@prisma/client';
import { UserRole } from '@whatsapp-platform/shared-types';

const AI_TRIAL_DAYS = 30;

/** Copies only the named keys that are present. The service is the last line of defence if a caller ever passes more than a DTO allows. */
function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

@Injectable()
export class ManageSettingsService {
  private readonly logger = new Logger(ManageSettingsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private emailService: EmailService,
    @InjectQueue(QueueName.AI_TRIAL) private aiTrialQueue: Queue,
  ) {}

  async get(tenantId: string) {
    return this.prisma.tenantSettings.findUnique({ where: { tenantId } });
  }

  /**
   * Sets how long a customer may wait for a person (null: no deadline). The new value also applies to requests that
   * are waiting right now and have not been flagged yet, so changing it takes effect immediately rather than only
   * for the next customer. Requests already flagged as breached stay flagged.
   */
  async updateReplyDeadline(tenantId: string, actorId: string, minutes: number | null) {
    const settings = await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, replyDeadlineMinutes: minutes },
      update: { replyDeadlineMinutes: minutes },
    });
    const updated = minutes == null
      ? await this.prisma.$executeRaw`
          UPDATE conversations SET sla_deadline = NULL
          WHERE tenant_id = ${tenantId} AND status::text = 'REQUESTED' AND NOT sla_breached`
      : await this.prisma.$executeRaw`
          UPDATE conversations SET sla_deadline = COALESCE(requested_at, created_at) + make_interval(mins => ${minutes}::int)
          WHERE tenant_id = ${tenantId} AND status::text = 'REQUESTED' AND NOT sla_breached`;
    this.logger.log(`[tenant:${tenantId}] reply deadline set to ${minutes ?? 'off'} by ${actorId}; ${updated} waiting request(s) re-timed`);
    return settings;
  }

  async updateWelcome(tenantId: string, input: { welcomeEnabled?: boolean; welcomeMessage?: string }) {
    const data = pick(input, ['welcomeEnabled', 'welcomeMessage'] as const);
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async updateOffHours(tenantId: string, input: {
    offHoursEnabled?: boolean;
    offHoursMessage?: string;
    offHoursSchedule?: Prisma.InputJsonValue;
  }) {
    const data = pick(input, ['offHoursEnabled', 'offHoursMessage', 'offHoursSchedule'] as const);
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async updateOptInOut(tenantId: string, input: {
    optOutKeywords?: string[];
    optInKeywords?: string[];
    optOutReply?: string;
    optInReply?: string;
  }) {
    const data = pick(input, ['optOutKeywords', 'optInKeywords', 'optOutReply', 'optInReply'] as const);
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async updateWidget(tenantId: string, input: {
    widgetEnabled?: boolean;
    widgetConfig?: Prisma.InputJsonValue;
  }) {
    const data = pick(input, ['widgetEnabled', 'widgetConfig'] as const);
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  async updateAi(tenantId: string, input: {
    aiEnabled?: boolean;
    aiAlwaysOn?: boolean;
    aiPersonality?: string;
    aiMode?: string;
    aiPilotGroup?: boolean;
  }) {
    const data = pick(input, ['aiEnabled', 'aiAlwaysOn', 'aiPersonality', 'aiMode', 'aiPilotGroup'] as const);
    const existing = await this.prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { aiTrialStartedAt: true, aiEnabled: true },
    });

    const updateData: Prisma.TenantSettingsUpdateInput = { ...data };

    // First time enabling AI — start 30-day learning trial
    if (data.aiEnabled === true && !existing?.aiTrialStartedAt) {
      const trialStart = new Date();
      updateData.aiTrialStartedAt = trialStart;

      // Remove any previous job and schedule new one
      try {
        const prev = await this.aiTrialQueue.getJob(`ai-trial-${tenantId}`);
        if (prev) await prev.remove();
      } catch { /* ignore */ }

      const delay = AI_TRIAL_DAYS * 24 * 60 * 60 * 1000;
      await this.aiTrialQueue.add(
        'expire',
        { tenantId } satisfies AiTrialExpireJob,
        { jobId: `ai-trial-${tenantId}`, delay, removeOnComplete: true, removeOnFail: true },
      );

      this.logger.log(`AI trial started for tenant ${tenantId} — expires in ${AI_TRIAL_DAYS} days`);
    }

    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...updateData } as Parameters<typeof this.prisma.tenantSettings.create>[0]['data'],
      update: updateData,
    });
  }

  async approveAi(tenantId: string) {
    // Must have active paid subscription
    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });

    const isPaid = sub && sub.status === 'ACTIVE' && sub.plan.monthlyPrice > 0;
    if (!isPaid) {
      throw new ForbiddenException('An active paid plan is required to activate VerzAI.');
    }

    // Must have AI credits
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiCredits: true },
    });
    if (!tenant || tenant.aiCredits <= 0) {
      throw new ForbiddenException('AI credits are required to activate VerzAI. Purchase credits first.');
    }

    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, aiEnabled: true, aiTrialApprovedAt: new Date() },
      update: { aiEnabled: true, aiTrialApprovedAt: new Date() },
    });
  }

  async notifySubscriptionDowngraded(tenantId: string) {
    const [admins, tenant] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] }, isActive: true },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    ]);

    const workspaceName = tenant?.name ?? 'your workspace';
    const frontendUrl = process.env['FRONTEND_URL'] ?? 'https://app.verzchat.com';

    for (const admin of admins) {
      await this.notificationsService.notifyUser(admin.id, tenantId, {
        type: 'SYSTEM' as never,
        title: 'Plan downgraded to Free',
        body: `Your subscription for ${workspaceName} has expired and been downgraded to the Free plan. Some features are now limited.`,
        link: '/billing',
      }).catch(() => null);

      await this.emailService.sendRaw({
        to: admin.email,
        subject: `Your ${workspaceName} subscription has expired`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:#dc2626;padding:32px 40px;text-align:center">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700">Subscription expired</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;color:#374151;font-size:15px">Hi ${admin.name},</p>
          <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6">
            Your subscription for <strong>${workspaceName}</strong> has expired and access has been downgraded to the <strong>Free plan</strong>.
          </p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#374151;font-size:14px;line-height:1.8">
            <li>Campaigns are paused</li>
            <li>Agent access limited to 2</li>
            <li>AI agent paused</li>
            <li>You can still send and receive messages</li>
          </ul>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${frontendUrl}/billing" target="_blank"
                style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                Renew Subscription
              </a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
          <p style="margin:0;color:#d1d5db;font-size:11px">© VerzChat</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      }).catch(() => null);
    }
  }

  async notifyAiTrialExpired(tenantId: string) {
    const [admins, tenant] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] }, isActive: true },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    ]);

    const workspaceName = tenant?.name ?? 'your workspace';
    const frontendUrl = process.env['FRONTEND_URL'] ?? 'https://app.verzchat.com';

    for (const admin of admins) {
      // In-app notification
      await this.notificationsService.notifyUser(admin.id, tenantId, {
        type: 'SYSTEM' as never,
        title: 'VerzAI learning period complete',
        body: `VerzAI has finished its 30-day learning period for ${workspaceName}. Approve it to start auto-replying.`,
        link: '/settings/ai',
      }).catch(() => null);

      // Email
      await this.emailService.sendRaw({
        to: admin.email,
        subject: `VerzAI is ready, approve to activate for ${workspaceName}`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700">VerzAI is ready to work</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;color:#374151;font-size:15px">Hi ${admin.name},</p>
          <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6">
            VerzAI has completed its <strong>30-day learning period</strong> for <strong>${workspaceName}</strong>.
            It has been observing your conversations and is now ready to start replying as an AI agent.
          </p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">
            To activate VerzAI, you need an active paid plan and AI credits. Then approve it in your AI settings.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${frontendUrl}/settings/ai" target="_blank"
                style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                Approve VerzAI
              </a>
            </td></tr>
          </table>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">
            You can also buy AI credits from the Billing page.
          </p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
          <p style="margin:0;color:#d1d5db;font-size:11px">© VerzChat: ${workspaceName}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      }).catch(() => null);
    }
  }
}
