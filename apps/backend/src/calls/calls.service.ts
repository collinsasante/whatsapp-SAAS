import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConversationStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import {
  CreateCallDto, UpdateCallDto, ListCallsDto, CreateCallNoteDto,
  TransferCallDto, MuteCallDto, HoldCallDto, AnalyticsQueryDto, InitiateCallDto,
} from './dto/call.dto';
import { ActivityAction, CallDirection, CallStatus } from '@whatsapp-platform/shared-types';

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
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    @Inject(forwardRef(() => WhatsAppService)) private whatsapp: WhatsAppService,
    private activityLogService: ActivityLogService,
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
      const totalMs = withResponse.reduce((acc: number, c: { answeredAt: Date | null; createdAt: Date }) => {
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

  async initiateCall(tenantId: string, userId: string, dto: InitiateCallDto) {
    const phone = dto.phone.trim();
    if (!phone) throw new BadRequestException('Phone number is required');

    // Resolve contactId if not provided but phone matches a known contact
    let contactId = dto.contactId;
    if (!contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { tenantId, phone: { contains: phone.replace(/^\+/, '') } },
        select: { id: true },
      });
      contactId = contact?.id;
    }

    // Place the real WhatsApp call via Meta API
    const { callId: whatsappCallId } = await this.whatsapp.initiateWhatsAppCall(tenantId, phone, dto.type ?? 'audio', dto.sdpOffer);

    const call = await this.prisma.callLog.create({
      data: {
        tenantId,
        userId,
        ...(contactId && { contactId }),
        phone,
        direction: CallDirection.OUTBOUND,
        status: CallStatus.INITIATED,
        startedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(whatsappCallId && { ['whatsappCallId' as any]: whatsappCallId }),
        metadata: { type: dto.type ?? 'audio' } as Prisma.InputJsonValue,
      },
      include: CALL_INCLUDE,
    });

    this.realtime.emitCallEvent(tenantId, 'call_created', call as unknown as Record<string, unknown>);
    return { ...call, whatsappCallId };
  }

  async handleCallWebhook(
    tenantId: string,
    callEvents: Array<{ id: string; from?: string; event: string; status?: string; timestamp?: string; direction?: string; duration?: number; start_time?: string; end_time?: string; session?: { sdp_type: string; sdp: string } }>,
  ) {
    const EVENT_TO_STATUS: Record<string, CallStatus> = {
      accept:    CallStatus.ANSWERED,
      terminate: CallStatus.COMPLETED,
      reject:    CallStatus.MISSED,
    };

    for (const event of callEvents) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prismaAny = this.prisma as any;
        // eslint-disable-next-line prefer-const
        let existing = await prismaAny.callLog.findFirst({
          where: { whatsappCallId: event.id, tenantId },
        }) as { id: string } | null;

        // For BUSINESS_INITIATED connect events (outbound call answered by user),
        // the call record might not exist yet due to race condition — retry briefly
        if (!existing && event.event === 'connect' && event.direction === 'BUSINESS_INITIATED' && event.session?.sdp_type === 'answer') {
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 300));
            existing = await prismaAny.callLog.findFirst({
              where: { whatsappCallId: event.id, tenantId },
            }) as { id: string } | null;
            if (existing) break;
          }
        }

        // Outbound call ringing on user's device: Meta sends SDP answer so we can set up WebRTC
        // The user hasn't answered yet — just their device is ringing. Timer starts when they pick up.
        if (existing && event.event === 'connect' && event.direction === 'BUSINESS_INITIATED' && event.session?.sdp_type === 'answer') {
          const sdpAnswer = event.session.sdp;
          await this.prisma.callLog.update({
            where: { id: existing.id },
            data: { status: CallStatus.RINGING },
          });
          this.realtime.emitCallEvent(tenantId, 'call_ringing', {
            callLogId: existing.id,
            whatsappCallId: event.id,
            sdpAnswer,
          });
          this.logger.log(`[calls] Outbound call ringing, emitting call_ringing for callLogId=${existing.id}, tenant=${tenantId}`);
          continue;
        }

        // Outbound call accepted by user (they picked up)
        if (existing && event.event === 'accept' && event.direction === 'BUSINESS_INITIATED') {
          await this.prisma.callLog.update({
            where: { id: existing.id },
            data: { status: CallStatus.ANSWERED, answeredAt: new Date() },
          });
          this.realtime.emitCallEvent(tenantId, 'call_connected', {
            callLogId: existing.id,
            whatsappCallId: event.id,
          });
          this.logger.log(`[calls] Outbound call answered by user, emitting call_connected for callLogId=${existing.id}, tenant=${tenantId}`);
          continue;
        }

        // Inbound call arriving: Meta sends event=connect with SDP offer
        // Skip BUSINESS_INITIATED events — those are outbound calls handled above
        if (!existing && event.event === 'connect' && event.from && event.direction !== 'BUSINESS_INITIATED') {
          const phone = event.from;
          const contact = await this.prisma.contact.findFirst({
            where: { tenantId, phone: { contains: phone } },
            select: { id: true, name: true, phone: true },
          });

          const sdpOffer = event.session?.sdp ?? null;

          const call = await prismaAny.callLog.create({
            data: {
              tenantId,
              ...(contact && { contactId: contact.id }),
              phone,
              direction: CallDirection.INBOUND,
              status: CallStatus.RINGING,
              startedAt: new Date(),
              whatsappCallId: event.id,
              metadata: { sdpOffer } as Prisma.InputJsonValue,
            },
            include: CALL_INCLUDE,
          }) as Record<string, unknown> & { id: string };

          this.realtime.emitCallEvent(tenantId, 'incoming_call', {
            callLogId: call.id,
            whatsappCallId: event.id,
            from: phone,
            contactName: contact?.name ?? null,
            sdpOffer,
          });
          this.logger.log(`[calls] Inbound call created ${call.id} from ${phone}, tenant=${tenantId}`);
          continue;
        }

        const mappedStatus = EVENT_TO_STATUS[event.event];
        if (!mappedStatus || !existing) {
          if (!existing && event.event !== 'connect') this.logger.warn(`No call log for whatsappCallId ${event.id}, event=${event.event}`);
          continue;
        }

        // For terminate events on outbound calls: if never answered, mark MISSED not COMPLETED
        let finalStatus = mappedStatus;
        if (event.event === 'terminate' && mappedStatus === CallStatus.COMPLETED) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const record = await (this.prisma as any).callLog.findFirst({
            where: { id: existing.id },
            select: { answeredAt: true, direction: true },
          }) as { answeredAt: Date | null; direction: string } | null;
          if (record && !record.answeredAt) {
            finalStatus = CallStatus.MISSED;
          }
        }

        const updateData: Record<string, unknown> = { status: finalStatus };
        if (finalStatus === CallStatus.ANSWERED) updateData['answeredAt'] = new Date();
        if ([CallStatus.COMPLETED, CallStatus.MISSED, CallStatus.FAILED].includes(finalStatus)) {
          updateData['endedAt'] = new Date();
          if (event.duration != null) updateData['duration'] = event.duration;
        }

        const updated = await this.prisma.callLog.update({
          where: { id: existing.id },
          data: updateData as Prisma.CallLogUpdateInput,
          include: CALL_INCLUDE,
        });

        this.realtime.emitCallEvent(tenantId, 'call_updated', updated as unknown as Record<string, unknown>);

        // Log call activity to the conversation when call ends
        if ([CallStatus.COMPLETED, CallStatus.MISSED, CallStatus.FAILED].includes(finalStatus)) {
          void this.logCallEndedActivity(tenantId, updated as unknown as Parameters<typeof this.logCallEndedActivity>[1], event.duration);
        }
      } catch (err) {
        this.logger.error(`Failed to handle call webhook event for ${event.id}: ${err}`);
      }
    }
  }

  async respondToCall(
    tenantId: string,
    callLogId: string,
    action: 'pre_accept' | 'accept' | 'reject' | 'terminate',
    sdpAnswer?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = await (this.prisma as any).callLog.findFirst({
      where: { id: callLogId, tenantId },
      select: { id: true, whatsappCallId: true },
    }) as { id: string; whatsappCallId: string | null } | null;

    if (!call) throw new NotFoundException('Call not found');

    // Attempt to signal Meta — best-effort, call may already be ended on their side
    if (call.whatsappCallId) {
      try {
        await this.whatsapp.respondToWhatsAppCall(tenantId, call.whatsappCallId, action, sdpAnswer);
      } catch (err) {
        this.logger.warn(`[calls] respondToWhatsAppCall non-fatal error for action=${action}: ${err}`);
      }
    }

    const STATUS_MAP: Partial<Record<string, CallStatus>> = {
      accept: CallStatus.ANSWERED,
      reject: CallStatus.MISSED,
      terminate: CallStatus.COMPLETED,
    };

    const newStatus = STATUS_MAP[action];
    if (newStatus) {
      const updateData: Prisma.CallLogUpdateInput = { status: newStatus };
      if (action === 'accept') updateData.answeredAt = new Date();
      if (action === 'reject' || action === 'terminate') updateData.endedAt = new Date();

      const updated = await this.prisma.callLog.update({
        where: { id: callLogId },
        data: updateData,
        include: CALL_INCLUDE,
      });
      this.realtime.emitCallEvent(tenantId, 'call_updated', updated as unknown as Record<string, unknown>);

    }

    return { success: true };
  }

  // Log a CALL_ENDED activity to the contact's most recent active conversation
  private async logCallEndedActivity(
    tenantId: string,
    call: { id: string; contactId?: string | null; direction: CallDirection; status: CallStatus; answeredAt?: Date | null; endedAt?: Date | null; startedAt?: Date | null; userId?: string | null },
    webhookDuration?: number,
  ) {
    if (!call.contactId) {
      this.logger.warn(`[calls] logCallEndedActivity skipped: no contactId for callId=${call.id}`);
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conv = await (this.prisma as any).conversation.findFirst({
        where: {
          tenantId,
          contactId: call.contactId,
          status: { in: [ConversationStatus.OPEN, ConversationStatus.REQUESTED, ConversationStatus.INTERVENED, ConversationStatus.RESOLVED, ConversationStatus.PENDING, ConversationStatus.SNOOZED] },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }) as { id: string } | null;
      this.logger.log(`[calls] logCallEndedActivity callId=${call.id} contactId=${call.contactId} → conv=${conv?.id ?? 'NONE'} duration=${webhookDuration}`);
      if (!conv) return;

      const duration = webhookDuration ??
        (call.answeredAt && call.endedAt
          ? Math.floor((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000)
          : 0);

      // If COMPLETED but never answered, treat as MISSED visually
      const effectiveStatus = (call.status === CallStatus.COMPLETED && !call.answeredAt)
        ? CallStatus.MISSED
        : call.status;

      await this.activityLogService.log({
        tenantId,
        action: ActivityAction.CALL_ENDED,
        conversationId: conv.id,
        userId: call.userId ?? undefined,
        metadata: {
          callLogId: call.id,
          direction: call.direction,
          status: effectiveStatus,
          duration,
        },
      });
    } catch (err) {
      this.logger.warn(`[calls] Failed to log call activity: ${err}`);
    }
  }

  async getCallPermission(tenantId: string, phone: string) {
    return this.whatsapp.checkCallPermission(tenantId, phone);
  }

  async requestCallPermission(tenantId: string, phone: string) {
    const messageId = await this.whatsapp.requestCallPermission(tenantId, phone);
    return { success: true, messageId };
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
