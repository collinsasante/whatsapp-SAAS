import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  CreateCallDto, UpdateCallDto, ListCallsDto, CreateCallNoteDto,
  TransferCallDto, MuteCallDto, HoldCallDto, AnalyticsQueryDto,
} from './dto/call.dto';
import { CallDirection, CallStatus } from '@whatsapp-platform/shared-types';

const CALL_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
  user: { select: { id: true, name: true, avatarUrl: true } },
  callNotes: {
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.CallLogInclude;

@Injectable()
export class CallsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  async findAll(tenantId: string, dto: ListCallsDto) {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.CallLogWhereInput = { tenantId };

    // Archived tab — show only archived; all other tabs exclude archived
    if (dto.isArchived === 'true') {
      where.isArchived = true;
    } else if (!dto.isArchived) {
      where.isArchived = false;
    }

    if (dto.direction) where.direction = dto.direction;
    if (dto.status) where.status = dto.status;
    if (dto.contactId) where.contactId = dto.contactId;
    if (dto.userId) where.userId = dto.userId;
    if (dto.from || dto.to) {
      where.createdAt = {};
      if (dto.from) where.createdAt.gte = new Date(dto.from);
      if (dto.to) where.createdAt.lte = new Date(dto.to);
    }
    if (dto.search) {
      where.OR = [
        { contact: { name: { contains: dto.search, mode: 'insensitive' } } },
        { contact: { phone: { contains: dto.search } } },
        { phone: { contains: dto.search } },
      ];
    }

    const [calls, total] = await Promise.all([
      this.prisma.callLog.findMany({
        where, skip, take: limit,
        include: CALL_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.callLog.count({ where }),
    ]);

    return {
      data: calls,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string) {
    const call = await this.prisma.callLog.findFirst({
      where: { id, tenantId },
      include: CALL_INCLUDE,
    });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  async create(tenantId: string, userId: string, dto: CreateCallDto) {
    const call = await this.prisma.callLog.create({
      data: {
        tenantId,
        userId,
        ...(dto.contactId && { contactId: dto.contactId }),
        ...(dto.phone && { phone: dto.phone }),
        direction: dto.direction,
        status: dto.status,
        duration: dto.duration ?? null,
        notes: dto.notes ?? null,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
        endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
        metadata: {} as Prisma.InputJsonValue,
      },
      include: CALL_INCLUDE,
    });

    this.realtime.emitCallEvent(tenantId, 'call_created', call as unknown as Record<string, unknown>);
    return call;
  }

  async update(tenantId: string, id: string, dto: UpdateCallDto) {
    await this.findOne(tenantId, id);
    const call = await this.prisma.callLog.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.startedAt && { startedAt: new Date(dto.startedAt) }),
        ...(dto.answeredAt && { answeredAt: new Date(dto.answeredAt) }),
        ...(dto.endedAt && { endedAt: new Date(dto.endedAt) }),
        ...(dto.recordingUrl !== undefined && { recordingUrl: dto.recordingUrl }),
        ...(dto.endReason !== undefined && { endReason: dto.endReason }),
      },
      include: CALL_INCLUDE,
    });

    this.realtime.emitCallEvent(tenantId, 'call_updated', call as unknown as Record<string, unknown>);
    return call;
  }

  async archive(tenantId: string, id: string) {
    const existing = await this.findOne(tenantId, id);
    const call = await this.prisma.callLog.update({
      where: { id },
      data: { isArchived: !existing.isArchived },
      include: CALL_INCLUDE,
    });
    this.realtime.emitCallEvent(tenantId, 'call_updated', call as unknown as Record<string, unknown>);
    return call;
  }

  async mute(tenantId: string, id: string, dto: MuteCallDto) {
    const existing = await this.findOne(tenantId, id);
    const meta = (existing.metadata as Record<string, unknown>) ?? {};
    const call = await this.prisma.callLog.update({
      where: { id },
      data: { metadata: { ...meta, muted: dto.muted } as Prisma.InputJsonValue },
      include: CALL_INCLUDE,
    });
    this.realtime.emitCallEvent(tenantId, 'call_mute_changed', { callId: id, muted: dto.muted });
    return call;
  }

  async hold(tenantId: string, id: string, dto: HoldCallDto) {
    const existing = await this.findOne(tenantId, id);
    const meta = (existing.metadata as Record<string, unknown>) ?? {};
    const call = await this.prisma.callLog.update({
      where: { id },
      data: { metadata: { ...meta, held: dto.held } as Prisma.InputJsonValue },
      include: CALL_INCLUDE,
    });
    this.realtime.emitCallEvent(tenantId, 'call_hold_changed', { callId: id, held: dto.held });
    return call;
  }

  async transfer(tenantId: string, id: string, fromUserId: string, dto: TransferCallDto) {
    const existing = await this.findOne(tenantId, id);
    const toUser = await this.prisma.user.findFirst({ where: { id: dto.toUserId, tenantId } });
    if (!toUser) throw new BadRequestException('Target agent not found in tenant');

    const meta = (existing.metadata as Record<string, unknown>) ?? {};
    const transferLog = {
      fromUserId,
      toUserId: dto.toUserId,
      reason: dto.reason ?? null,
      type: dto.transferType ?? 'BLIND',
      transferredAt: new Date().toISOString(),
    };
    const transfers = Array.isArray(meta['transfers']) ? [...(meta['transfers'] as unknown[]), transferLog] : [transferLog];

    const call = await this.prisma.callLog.update({
      where: { id },
      data: {
        userId: dto.toUserId,
        status: CallStatus.TRANSFERRED,
        metadata: { ...meta, transfers } as Prisma.InputJsonValue,
      },
      include: CALL_INCLUDE,
    });

    this.realtime.emitCallEvent(tenantId, 'call_transferred', {
      callId: id,
      fromUserId,
      toUserId: dto.toUserId,
      toUserName: toUser.name,
    });
    return call;
  }

  async generateCallLink(tenantId: string, userId: string) {
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const call = await this.prisma.callLog.create({
      data: {
        tenantId,
        userId,
        direction: CallDirection.OUTBOUND,
        status: CallStatus.SCHEDULED,
        callLinkToken: token,
        callLinkExpiresAt: expiresAt,
        metadata: { type: 'link' } as Prisma.InputJsonValue,
      },
      include: CALL_INCLUDE,
    });

    const host = process.env['FRONTEND_URL'] ?? 'https://app.waplatform.com';
    return {
      call,
      token,
      url: `${host}/join/${token}`,
      expiresAt,
    };
  }

  async validateCallLink(token: string) {
    const call = await this.prisma.callLog.findFirst({
      where: {
        callLinkToken: token,
        callLinkExpiresAt: { gt: new Date() },
      },
      include: CALL_INCLUDE,
    });
    if (!call) throw new NotFoundException('Call link is invalid or expired');
    return call;
  }

  async getAnalytics(tenantId: string, dto: AnalyticsQueryDto) {
    const where: Prisma.CallLogWhereInput = { tenantId, isArchived: false };
    if (dto.from || dto.to) {
      where.createdAt = {};
      if (dto.from) where.createdAt.gte = new Date(dto.from);
      if (dto.to) where.createdAt.lte = new Date(dto.to);
    }

    const [all, missed, completed, withDuration, withResponse] = await Promise.all([
      this.prisma.callLog.count({ where }),
      this.prisma.callLog.count({ where: { ...where, status: CallStatus.MISSED } }),
      this.prisma.callLog.count({ where: { ...where, status: CallStatus.COMPLETED } }),
      this.prisma.callLog.aggregate({
        where: { ...where, duration: { not: null } },
        _avg: { duration: true },
        _sum: { duration: true },
      }),
      this.prisma.callLog.findMany({
        where: { ...where, answeredAt: { not: null } },
        select: { createdAt: true, answeredAt: true },
      }),
    ]);

    const avgDuration = Math.round(withDuration._avg.duration ?? 0);
    const missedRate = all > 0 ? Math.round((missed / all) * 100) : 0;
    const completionRate = all > 0 ? Math.round((completed / all) * 100) : 0;

    let avgResponseTime = 0;
    if (withResponse.length > 0) {
      const totalMs = withResponse.reduce((acc, c) => {
        return acc + (c.answeredAt!.getTime() - c.createdAt.getTime());
      }, 0);
      avgResponseTime = Math.round(totalMs / withResponse.length / 1000);
    }

    return {
      total: all,
      missed,
      completed,
      avgDuration,
      missedRate,
      completionRate,
      avgResponseTime,
      totalDuration: withDuration._sum.duration ?? 0,
    };
  }

  async addNote(tenantId: string, callId: string, userId: string, dto: CreateCallNoteDto) {
    await this.findOne(tenantId, callId);
    return this.prisma.callNote.create({
      data: { callLogId: callId, userId, content: dto.content },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.callLog.delete({ where: { id } });
    return { success: true };
  }

  async getStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, todayTotal, missed, scheduled, active] = await Promise.all([
      this.prisma.callLog.count({ where: { tenantId, isArchived: false } }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, createdAt: { gte: today } } }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, status: CallStatus.MISSED, createdAt: { gte: today } } }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, status: CallStatus.SCHEDULED } }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, status: { in: [CallStatus.RINGING, CallStatus.ANSWERED, CallStatus.INITIATED] } } }),
    ]);

    const inbound = await this.prisma.callLog.count({ where: { tenantId, isArchived: false, direction: CallDirection.INBOUND, createdAt: { gte: today } } });
    const outbound = await this.prisma.callLog.count({ where: { tenantId, isArchived: false, direction: CallDirection.OUTBOUND, createdAt: { gte: today } } });

    return { total, todayTotal, missed, scheduled, active, inbound, outbound };
  }
}
