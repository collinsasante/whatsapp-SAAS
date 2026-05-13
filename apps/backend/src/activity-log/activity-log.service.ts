import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ActivityAction } from '@whatsapp-platform/shared-types';

@Injectable()
export class ActivityLogService {
  constructor(
    private prisma: PrismaService,
    private realtimeService: RealtimeService,
  ) {}

  async log(params: {
    tenantId: string;
    action: ActivityAction;
    conversationId?: string;
    contactId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const entry = await this.prisma.activityLog.create({
      data: {
        tenantId: params.tenantId,
        action: params.action,
        conversationId: params.conversationId ?? null,
        contactId: params.contactId ?? null,
        userId: params.userId ?? null,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    if (params.conversationId) {
      this.realtimeService.emitActivityLog(
        params.tenantId,
        params.conversationId,
        entry as unknown as Record<string, unknown>,
      );
    }

    return entry;
  }

  async getForConversation(tenantId: string, conversationId: string) {
    return this.prisma.activityLog.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async getForTenant(tenantId: string, limit = 50) {
    return this.prisma.activityLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
        conversation: { select: { id: true, contact: { select: { name: true, phone: true } } } },
      },
    });
  }
}
