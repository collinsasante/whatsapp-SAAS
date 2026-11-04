import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export const DEFAULT_CAP_WARN_PERCENT = 80;
export type CapState = 'NO_CAP' | 'OK' | 'WARNING' | 'REACHED';

/** Where a workspace stands against its daily cap. `used` is settled + currently reserved credits. Pure. */
export function capStateFor(used: number, cap: number | null | undefined, warnPercent: number | null | undefined): CapState {
  if (cap === null || cap === undefined) return 'NO_CAP';
  if (used >= cap) return 'REACHED';
  const warn = warnPercent ?? DEFAULT_CAP_WARN_PERCENT;
  return used * 100 >= warn * cap ? 'WARNING' : 'OK';
}

export interface CapAlert { level: 'WARNING' | 'REACHED'; cap: number; used: number; warnPercent: number; resetsAt: Date; timezone: string }

/** Tells a workspace's admins about a cap threshold. Admins only: usage and spend are not for every agent. */
@Injectable()
export class AiCapAlertNotifier {
  private readonly logger = new Logger(AiCapAlertNotifier.name);
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async deliver(tenantId: string, a: CapAlert): Promise<number> {
    const admins = await this.prisma.user.findMany({ where: { tenantId, isActive: true, role: 'ADMIN' }, select: { id: true } });
    const reset = a.resetsAt.toISOString();
    const reached = a.level === 'REACHED';
    const title = reached ? 'Verz AI paused: daily spend cap reached' : `Verz AI has used ${a.warnPercent}% of today's cap`;
    const body = reached
      ? `Verz AI used ${a.used} of ${a.cap} credits allowed today, so it will not reply until the cap resets (${reset}). Conversations stay open for your team.`
      : `Verz AI has used ${a.used} of ${a.cap} credits allowed today. At ${a.cap} it stops replying until the cap resets (${reset}).`;
    await Promise.all(admins.map((u) => this.notifications.create({
      tenantId, userId: u.id, type: NotificationType.SYSTEM, title, body, link: '/billing',
      metadata: { kind: 'ai_spend_cap', level: a.level, cap: a.cap, used: a.used, timezone: a.timezone },
    })));
    this.logger.log(`AI spend cap ${a.level} alert delivered for tenant ${tenantId} to ${admins.length} admin(s)`);
    return admins.length;
  }
}
