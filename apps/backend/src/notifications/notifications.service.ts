import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationType, Prisma } from '@prisma/client';
import { PushTokenService } from './push-token.service';
import { ExpoPushService } from './expo-push.service';

interface CreateNotificationDto {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private pushTokens: PushTokenService,
    private expoPush: ExpoPushService,
  ) {}

  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        tenantId: dto.tenantId,
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        link: dto.link,
        metadata: dto.metadata ?? {},
      },
    });

    // Emit realtime event to the user's personal room
    this.realtime.emitToUser(dto.userId, 'notification:new', notification);

    // Every real "notify this user" call site in the codebase already goes
    // through this one method, so hooking push in here -- rather than at
    // each individual call site -- gets every existing trigger (conversation
    // assignment/transfer, human-handoff escalation, internal tasks, admin
    // alerts) a real push for free. Fire-and-forget: a push failure must
    // never be why the in-app notification (the actual source of truth)
    // fails to have been created above.
    void this.sendPush(dto).catch((err) => this.logger.warn(`Push send failed for notification ${notification.id}: ${String(err)}`));

    return notification;
  }

  private async sendPush(dto: CreateNotificationDto) {
    const tokens = await this.pushTokens.getTokensForUser(dto.userId);
    if (tokens.length === 0) return;

    const metadata = (dto.metadata ?? {}) as Record<string, unknown>;
    const { invalidTokens } = await this.expoPush.send(tokens, {
      title: dto.title,
      body: dto.body,
      data: {
        ...(typeof metadata['conversationId'] === 'string' ? { conversationId: metadata['conversationId'] } : {}),
        type: dto.type,
        link: dto.link,
      },
    });
    if (invalidTokens.length > 0) await this.pushTokens.pruneInvalid(invalidTokens);
  }

  async findAll(userId: string, tenantId: string, limit = 30) {
    return this.prisma.notification.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getUnreadCount(userId: string, tenantId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, tenantId, isRead: false },
    });
    return { count };
  }

  async markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string, tenantId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, tenantId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  // Helper: notify all admins + agents in a tenant about an event
  async notifyTenant(
    tenantId: string,
    excludeUserId: string | null,
    dto: Omit<CreateNotificationDto, 'tenantId' | 'userId'>,
  ): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: ['ADMIN', 'AGENT'] } },
      select: { id: true },
    });
    await Promise.all(
      users
        .filter((u) => u.id !== excludeUserId)
        .map((u) => this.create({ ...dto, tenantId, userId: u.id })),
    );
  }

  // Helper: notify the assigned agent
  async notifyUser(
    userId: string,
    tenantId: string,
    dto: Omit<CreateNotificationDto, 'tenantId' | 'userId'>,
  ) {
    return this.create({ ...dto, tenantId, userId });
  }
}
