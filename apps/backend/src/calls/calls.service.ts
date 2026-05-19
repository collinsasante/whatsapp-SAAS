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

/** Statuses that represent an active/live call */
const ACTIVE_STATUSES = [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.ONGOING, CallStatus.RECONNECTING];

/** Statuses that represent a terminal (finished) call */
const TERMINAL_STATUSES = [
  CallStatus.ENDED, CallStatus.MISSED, CallStatus.DECLINED,
  CallStatus.CANCELED, CallStatus.UNANSWERED, CallStatus.BUSY, CallStatus.FAILED, CallStatus.VOICEMAIL,
];

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    @Inject(forwardRef(() => WhatsAppService)) private whatsapp: WhatsAppService,
    private activityLogService: ActivityLogService,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async findAll(tenantId: string, dto: ListCallsDto) {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.CallLogWhereInput = { tenantId };

    if (dto.isArchived === 'true') {
      where.isArchived = true;
    } else if (!dto.isArchived) {
      where.isArchived = false;
    }

    if (dto.direction) where.direction = dto.direction;

    // Missed tab shows both MISSED (inbound not answered) and UNANSWERED (outbound not answered)
    if (dto.status === 'MISSED') {
      where.status = { in: [CallStatus.MISSED, CallStatus.UNANSWERED] };
    } else if (dto.status) {
      where.status = dto.status;
    }

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

    this.emit('call_created', tenantId, call);
    return call;
  }

  async update(tenantId: string, id: string, dto: UpdateCallDto) {
    const existing = await this.findOne(tenantId, id);
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

    // Log call activity when a terminal status is set via the app (hang-up, cancel, etc.)
    // The Meta webhook path already calls logCallActivity; guard against double-logging.
    const TERMINAL_STATUSES = new Set([
      CallStatus.ENDED, CallStatus.MISSED, CallStatus.DECLINED,
      CallStatus.CANCELED, CallStatus.UNANSWERED, CallStatus.FAILED,
    ]);
    const wasAlreadyTerminal = existing?.status != null && TERMINAL_STATUSES.has(existing.status as CallStatus);
    if (dto.status && TERMINAL_STATUSES.has(dto.status as CallStatus) && !wasAlreadyTerminal) {
      void this.logCallActivity(
        tenantId,
        call as unknown as CallRecord,
        this.statusToActivityAction(dto.status as CallStatus),
      );
    }

    // Backfill recording URL into the CALL_ENDED activity log so the chat window can render
    // the audio player — the log is created before upload completes so recordingUrl was null.
    if (dto.recordingUrl) {
      const log = await this.prisma.activityLog.findFirst({
        where: {
          tenantId,
          action: ActivityAction.CALL_ENDED,
          metadata: { path: ['callLogId'], equals: id },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (log) {
        const meta = (log.metadata as Record<string, unknown>) ?? {};
        const updatedMeta = { ...meta, recordingUrl: dto.recordingUrl };
        await this.prisma.activityLog.update({
          where: { id: log.id },
          data: { metadata: updatedMeta as Prisma.InputJsonValue },
        });
        const convId = meta.conversationId as string | undefined;
        if (convId) {
          this.realtime.emitActivityLogUpdated(tenantId, convId, { id: log.id, metadata: updatedMeta });
        }
      }
    }

    this.emit('call_updated', tenantId, call);
    return call;
  }

  async archive(tenantId: string, id: string) {
    const existing = await this.findOne(tenantId, id);
    const call = await this.prisma.callLog.update({
      where: { id },
      data: { isArchived: !existing.isArchived },
      include: CALL_INCLUDE,
    });
    this.emit('call_updated', tenantId, call);
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
        metadata: { ...meta, transfers } as Prisma.InputJsonValue,
      },
      include: CALL_INCLUDE,
    });

    this.realtime.emitCallEvent(tenantId, 'call_transferred', {
      callId: id,
      fromUserId,
      toUserId: dto.toUserId,
      toUserName: toUser.name,
      call,
    });
    return call;
  }

  async generateCallLink(tenantId: string, userId: string) {
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const call = await this.prisma.callLog.create({
      data: {
        tenantId,
        userId,
        direction: CallDirection.OUTGOING,
        status: CallStatus.SCHEDULED,
        callLinkToken: token,
        callLinkExpiresAt: expiresAt,
        metadata: { type: 'link' } as Prisma.InputJsonValue,
      },
      include: CALL_INCLUDE,
    });

    const host = process.env['FRONTEND_URL'] ?? 'https://app.waplatform.com';
    return { call, token, url: `${host}/join/${token}`, expiresAt };
  }

  async validateCallLink(token: string) {
    const call = await this.prisma.callLog.findFirst({
      where: { callLinkToken: token, callLinkExpiresAt: { gt: new Date() } },
      include: CALL_INCLUDE,
    });
    if (!call) throw new NotFoundException('Call link is invalid or expired');
    return call;
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

  // ─── Permissions ───────────────────────────────────────────────────────────

  async getCallPermission(tenantId: string, phone: string) {
    return this.whatsapp.checkCallPermission(tenantId, phone);
  }

  async requestCallPermission(tenantId: string, phone: string) {
    const messageId = await this.whatsapp.requestCallPermission(tenantId, phone);
    return { success: true, messageId };
  }

  // ─── Initiate outbound call ────────────────────────────────────────────────

  async initiateCall(tenantId: string, userId: string, dto: InitiateCallDto) {
    const phone = dto.phone.trim();
    if (!phone) throw new BadRequestException('Phone number is required');

    let contactId = dto.contactId;
    if (!contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { tenantId, phone: { contains: phone.replace(/^\+/, '') } },
        select: { id: true },
      });
      contactId = contact?.id;
    }

    const { callId: whatsappCallId } = await this.whatsapp.initiateWhatsAppCall(
      tenantId, phone, dto.type ?? 'audio', dto.sdpOffer,
    ).catch((err: Error) => {
      throw new BadRequestException(err.message ?? 'Could not initiate WhatsApp call');
    });

    const call = await this.prisma.callLog.create({
      data: {
        tenantId,
        userId,
        ...(contactId && { contactId }),
        phone,
        direction: CallDirection.OUTGOING,
        status: CallStatus.INITIATED,
        startedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(whatsappCallId && { ['whatsappCallId' as any]: whatsappCallId }),
        metadata: { type: dto.type ?? 'audio' } as Prisma.InputJsonValue,
      },
      include: CALL_INCLUDE,
    });

    this.emit('call_initiated', tenantId, call);
    this.emit('call_created', tenantId, call);

    return { ...call, whatsappCallId };
  }

  // ─── Respond to inbound call (agent side) ─────────────────────────────────

  async respondToCall(
    tenantId: string,
    callLogId: string,
    action: 'pre_accept' | 'accept' | 'reject' | 'terminate',
    sdpAnswer?: string,
    agentUserId?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = await (this.prisma as any).callLog.findFirst({
      where: { id: callLogId, tenantId },
      select: { id: true, whatsappCallId: true, direction: true, status: true, answeredAt: true, userId: true },
    }) as { id: string; whatsappCallId: string | null; direction: string; status: string; answeredAt: Date | null; userId: string | null } | null;

    if (!call) throw new NotFoundException('Call not found');

    // Prevent accepting a call that is already in a terminal state (race: WebRTC audio
    // detection fires after WhatsApp terminate webhook already closed the call).
    if (action === 'accept' && TERMINAL_STATUSES.includes(call.status as CallStatus)) {
      this.logger.warn(`[calls] respondToCall accept skipped — already terminal status=${call.status} callLogId=${callLogId}`);
      return { success: true };
    }

    // Signal Meta (best-effort)
    if (call.whatsappCallId) {
      try {
        await this.whatsapp.respondToWhatsAppCall(tenantId, call.whatsappCallId, action, sdpAnswer);
      } catch (err) {
        this.logger.warn(`[calls] respondToWhatsAppCall non-fatal for action=${action}: ${err}`);
      }
    }

    let newStatus: CallStatus | null = null;
    const updateData: Prisma.CallLogUpdateInput = {};

    switch (action) {
      case 'accept':
        newStatus = CallStatus.ONGOING;
        // Keep the earliest answeredAt — pre_accept may have already set it.
        if (!call.answeredAt) updateData.answeredAt = new Date();
        // Record which agent answered this inbound call
        if (agentUserId && !call.userId) updateData.user = { connect: { id: agentUserId } };
        break;

      case 'reject':
        // Agent declined an inbound call
        newStatus = CallStatus.DECLINED;
        updateData.endedAt = new Date();
        break;

      case 'terminate': {
        // If call was never answered → CANCELED (agent hung up before answer)
        // If call was active (ONGOING) → ENDED
        const wasAnswered = !!call.answeredAt || call.status === CallStatus.ONGOING;
        newStatus = wasAnswered ? CallStatus.ENDED : CallStatus.CANCELED;
        updateData.endedAt = new Date();
        if (!wasAnswered) {
          updateData.duration = 0;
        }
        break;
      }

      case 'pre_accept':
        // Agent intent-to-answer is recorded here. WebRTC ICE/negotiation can take
        // 4–19s before the final `accept` action arrives; if anything terminates
        // the call in that window we still want it counted as answered, not MISSED.
        // Status stays INCOMING until media is actually flowing on `accept`.
        if (!call.answeredAt) {
          await this.prisma.callLog.update({
            where: { id: callLogId },
            data: { answeredAt: new Date() },
          });
        }
        break;

      default:
        break;
    }

    if (newStatus) {
      updateData.status = newStatus;

      // For terminal transitions, use a conditional updateMany so only one writer
      // (us OR the webhook) calls logCallActivity — whichever wins count > 0.
      const TERMINAL_ARRAY = [
        CallStatus.ENDED, CallStatus.MISSED, CallStatus.DECLINED, CallStatus.CANCELED,
        CallStatus.UNANSWERED, CallStatus.BUSY, CallStatus.FAILED, CallStatus.VOICEMAIL,
      ];
      const isTerminal = TERMINAL_ARRAY.includes(newStatus);
      let weSetTerminalStatus = true;

      if (isTerminal) {
        const result = await this.prisma.callLog.updateMany({
          where: { id: callLogId, status: { notIn: TERMINAL_ARRAY } },
          data: updateData,
        });
        weSetTerminalStatus = result.count > 0;
      } else {
        await this.prisma.callLog.update({ where: { id: callLogId }, data: updateData });
      }

      // Fetch full call for emit (always needed for socket events)
      const updated = await this.prisma.callLog.findFirst({
        where: { id: callLogId },
        include: CALL_INCLUDE,
      });

      const eventName = this.statusToEvent(newStatus);
      this.emit(eventName, tenantId, updated!);
      this.emit('call_updated', tenantId, updated!);

      // Only log activity if we won the race against the webhook
      const AGENT_TERMINAL = new Set([CallStatus.ENDED, CallStatus.CANCELED, CallStatus.DECLINED]);
      if (weSetTerminalStatus && AGENT_TERMINAL.has(newStatus)) {
        void this.logCallActivity(
          tenantId,
          updated as unknown as CallRecord,
          this.statusToActivityAction(newStatus),
        );
      }
    }

    return { success: true };
  }

  // ─── Meta webhook handler ──────────────────────────────────────────────────

  async handleCallWebhook(
    tenantId: string,
    callEvents: Array<{
      id: string;
      from?: string;
      event: string;
      status?: string;
      timestamp?: string;
      direction?: string;
      duration?: number;
      start_time?: string;
      end_time?: string;
      session?: { sdp_type: string; sdp: string };
    }>,
  ) {
    for (const event of callEvents) {
      try {
        await this.processWebhookEvent(tenantId, event);
      } catch (err) {
        this.logger.error(`[calls] Failed to handle webhook event id=${event.id} event=${event.event}: ${err}`);
      }
    }
  }

  private async processWebhookEvent(
    tenantId: string,
    event: {
      id: string;
      from?: string;
      event: string;
      direction?: string;
      duration?: number;
      session?: { sdp_type: string; sdp: string };
    },
  ) {
    // Log EVERY incoming webhook event so we can see exactly what WhatsApp sends
    this.logger.log(
      `[calls] webhook event=${event.event} direction=${event.direction ?? 'none'} ` +
      `id=${event.id} sdp_type=${event.session?.sdp_type ?? 'none'} from=${event.from ?? 'none'}`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prismaAny = this.prisma as any;

    let existing = await prismaAny.callLog.findFirst({
      where: { whatsappCallId: event.id, tenantId },
      select: { id: true, direction: true, status: true, answeredAt: true },
    }) as { id: string; direction: string; status: string; answeredAt: Date | null } | null;

    // Outbound: Meta sends SDP answer as soon as customer's device rings
    // sdp_type=answer is sufficient — only outbound (business-initiated) calls produce an SDP answer.
    // Do NOT require event.direction here because Meta may omit it on some webhook deliveries.
    if (event.event === 'connect' && event.session?.sdp_type === 'answer') {
      // Retry briefly — race condition between webhook arrival and DB write
      if (!existing) {
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 300));
          existing = await prismaAny.callLog.findFirst({
            where: { whatsappCallId: event.id, tenantId },
            select: { id: true, direction: true, status: true, answeredAt: true },
          }) as typeof existing;
          if (existing) break;
        }
      }

      if (existing) {
        await this.prisma.callLog.update({
          where: { id: existing.id },
          data: { status: CallStatus.RINGING },
        });
        this.logger.log(`[calls] Outbound RINGING callLogId=${existing.id}`);
        this.realtime.emitCallEvent(tenantId, 'call_ringing', {
          callLogId: existing.id,
          whatsappCallId: event.id,
          sdpAnswer: event.session.sdp,
        });
      }
      return;
    }

    // Inbound: customer calling the agent (event=connect, no existing record)
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
          direction: CallDirection.INCOMING,
          status: CallStatus.RINGING,
          startedAt: new Date(),
          whatsappCallId: event.id,
          metadata: { sdpOffer } as Prisma.InputJsonValue,
        },
        include: CALL_INCLUDE,
      }) as Record<string, unknown> & { id: string };

      this.logger.log(`[calls] Inbound INCOMING callLogId=${call.id} from=${phone}`);
      this.realtime.emitCallEvent(tenantId, 'incoming_call', {
        callLogId: call.id,
        whatsappCallId: event.id,
        from: phone,
        contactName: contact?.name ?? null,
        sdpOffer,
        call,
      });
      return;
    }

    // Outbound: customer accepted the call (agent's device can start audio)
    // Use existing.direction from DB — do NOT rely on event.direction which Meta may omit.
    this.logger.log(
      `[calls] accept-check: event.event=${event.event} existing=${existing?.id ?? 'null'} ` +
      `existing.direction=${existing?.direction ?? 'null'} existing.status=${existing?.status ?? 'null'}`,
    );
    if (existing && event.event === 'accept' && existing.direction === CallDirection.OUTGOING) {
      await this.prisma.callLog.update({
        where: { id: existing.id },
        data: { status: CallStatus.ONGOING, answeredAt: new Date() },
      });
      this.logger.log(`[calls] Outbound ONGOING (accepted) callLogId=${existing.id}`);
      const updated = await this.prisma.callLog.findFirst({ where: { id: existing.id }, include: CALL_INCLUDE });
      this.realtime.emitCallEvent(tenantId, 'call_accepted', { callLogId: existing.id, whatsappCallId: event.id, call: updated });
      this.realtime.emitCallEvent(tenantId, 'call_connected', { callLogId: existing.id, whatsappCallId: event.id });
      this.emit('call_updated', tenantId, updated!);
      return;
    }

    if (!existing) {
      if (event.event !== 'connect') {
        this.logger.warn(`[calls] No call log for whatsappCallId=${event.id} event=${event.event}`);
      }
      return;
    }

    // Terminal events — skip if call is already in a terminal status (e.g. agent cancelled
    // before the webhook arrives, so CANCELED should not be overwritten by UNANSWERED)
    const TERMINAL_STATUSES = new Set([
      CallStatus.ENDED, CallStatus.MISSED, CallStatus.DECLINED, CallStatus.CANCELED,
      CallStatus.UNANSWERED, CallStatus.BUSY, CallStatus.FAILED, CallStatus.VOICEMAIL,
    ]);
    if (TERMINAL_STATUSES.has(existing.status as CallStatus)) {
      this.logger.log(
        `[calls] webhook event=${event.event} skipped — call already terminal status=${existing.status} callLogId=${existing.id}`,
      );
      return;
    }

    const direction = existing.direction as CallDirection;
    const wasAnswered = !!existing.answeredAt || existing.status === CallStatus.ONGOING;

    let finalStatus: CallStatus | null = null;

    switch (event.event) {
      case 'reject':
        // Customer declined an outbound call
        finalStatus = CallStatus.DECLINED;
        break;

      case 'terminate': {
        // duration > 0 means the callee was actually on the line — Meta never sends an
        // `accept` event for outbound calls, so this is the only reliable signal.
        const answeredViaWebhook = event.duration != null && event.duration > 0;
        if (wasAnswered || answeredViaWebhook) {
          finalStatus = CallStatus.ENDED;
        } else {
          // Not answered: outbound=UNANSWERED, inbound=MISSED
          finalStatus = direction === CallDirection.OUTGOING ? CallStatus.UNANSWERED : CallStatus.MISSED;
        }
        break;
      }

      case 'busy':
        finalStatus = CallStatus.BUSY;
        break;

      default:
        this.logger.warn(`[calls] Unhandled webhook event=${event.event} for callLogId=${existing.id}`);
        return;
    }

    const updateData: Prisma.CallLogUpdateInput = {
      status: finalStatus,
      endedAt: new Date(),
    };
    if (event.duration != null) updateData.duration = event.duration;
    // Retroactively set answeredAt when callee answered but Meta never emitted an accept webhook
    if (finalStatus === CallStatus.ENDED && !existing.answeredAt && event.duration != null && event.duration > 0) {
      updateData.answeredAt = new Date(Date.now() - event.duration * 1000);
      this.logger.log(`[calls] Retroactive answeredAt set from duration=${event.duration} callLogId=${existing.id}`);
    }

    const updated = await this.prisma.callLog.update({
      where: { id: existing.id },
      data: updateData,
      include: CALL_INCLUDE,
    });

    this.logger.log(`[calls] Terminal status=${finalStatus} callLogId=${existing.id}`);

    // Emit synthetic call_accepted before terminal events so the frontend bar transitions
    // through "connected" and can display the correct "Call ended" status (not "No answer").
    // This is needed because Meta never emits a real `accept` webhook for outbound calls.
    if (finalStatus === CallStatus.ENDED && updateData.answeredAt) {
      this.logger.log(`[calls] Synthetic call_accepted emitted callLogId=${existing.id}`);
      this.realtime.emitCallEvent(tenantId, 'call_accepted', { callLogId: existing.id, call: updated });
    }

    this.emit(this.statusToEvent(finalStatus), tenantId, updated);
    this.emit('call_updated', tenantId, updated);

    void this.logCallActivity(
      tenantId,
      updated as unknown as CallRecord,
      this.statusToActivityAction(finalStatus),
      event.duration,
    );
  }

  // ─── Analytics & Stats ─────────────────────────────────────────────────────

  async getAnalytics(tenantId: string, dto: AnalyticsQueryDto) {
    const where: Prisma.CallLogWhereInput = { tenantId, isArchived: false };
    if (dto.from || dto.to) {
      where.createdAt = {};
      if (dto.from) where.createdAt.gte = new Date(dto.from);
      if (dto.to) where.createdAt.lte = new Date(dto.to);
    }

    const [all, missed, completed, withDuration, withResponse] = await Promise.all([
      this.prisma.callLog.count({ where }),
      this.prisma.callLog.count({ where: { ...where, status: { in: [CallStatus.MISSED, CallStatus.UNANSWERED] } } }),
      this.prisma.callLog.count({ where: { ...where, status: CallStatus.ENDED } }),
      this.prisma.callLog.aggregate({
        where: { ...where, duration: { not: null }, status: CallStatus.ENDED },
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

  async getStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, todayTotal, missed, scheduled, active, inbound, outbound] = await Promise.all([
      this.prisma.callLog.count({ where: { tenantId, isArchived: false } }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, createdAt: { gte: today } } }),
      this.prisma.callLog.count({
        where: { tenantId, isArchived: false, status: { in: [CallStatus.MISSED, CallStatus.UNANSWERED] }, createdAt: { gte: today } },
      }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, status: CallStatus.SCHEDULED } }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, status: { in: ACTIVE_STATUSES } } }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, direction: CallDirection.INCOMING, createdAt: { gte: today } } }),
      this.prisma.callLog.count({ where: { tenantId, isArchived: false, direction: CallDirection.OUTGOING, createdAt: { gte: today } } }),
    ]);

    return { total, todayTotal, missed, scheduled, active, inbound, outbound };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** Emit a socket event with full call payload */
  private emit(event: string, tenantId: string, call: Record<string, unknown> | null) {
    this.realtime.emitCallEvent(tenantId, event, call as Record<string, unknown>);
  }

  /** Map a terminal CallStatus to its socket event name */
  private statusToEvent(status: CallStatus): string {
    const map: Partial<Record<CallStatus, string>> = {
      [CallStatus.ONGOING]:    'call_accepted',
      [CallStatus.ENDED]:      'call_ended',
      [CallStatus.MISSED]:     'call_missed',
      [CallStatus.DECLINED]:   'call_declined',
      [CallStatus.CANCELED]:   'call_canceled',
      [CallStatus.UNANSWERED]: 'call_unanswered',
      [CallStatus.BUSY]:       'call_updated',
      [CallStatus.FAILED]:     'call_updated',
    };
    return map[status] ?? 'call_updated';
  }

  /** Map a terminal CallStatus to its ActivityAction */
  private statusToActivityAction(status: CallStatus): ActivityAction {
    switch (status) {
      case CallStatus.MISSED:     return ActivityAction.CALL_MISSED;
      case CallStatus.DECLINED:   return ActivityAction.CALL_DECLINED;
      case CallStatus.CANCELED:   return ActivityAction.CALL_CANCELED;
      case CallStatus.UNANSWERED: return ActivityAction.CALL_MISSED;
      default:                    return ActivityAction.CALL_ENDED;
    }
  }

  /** Log a call lifecycle event to the contact's conversation thread */
  private async logCallActivity(
    tenantId: string,
    call: CallRecord,
    action: ActivityAction,
    webhookDuration?: number,
  ) {
    if (!call.contactId) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conv = await (this.prisma as any).conversation.findFirst({
        where: {
          tenantId,
          contactId: call.contactId,
          status: {
            in: [
              ConversationStatus.OPEN, ConversationStatus.REQUESTED,
              ConversationStatus.INTERVENED, ConversationStatus.RESOLVED,
              ConversationStatus.PENDING, ConversationStatus.SNOOZED,
            ],
          },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }) as { id: string } | null;

      if (!conv) return;

      const duration = webhookDuration ??
        (call.answeredAt && call.endedAt
          ? Math.floor((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000)
          : 0);

      await this.activityLogService.log({
        tenantId,
        action,
        conversationId: conv.id,
        userId: call.userId ?? undefined,
        metadata: {
          callLogId: call.id,
          direction: call.direction,
          status: call.status,
          duration,
          recordingUrl: call.recordingUrl ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`[calls] Failed to log call activity callId=${call.id}: ${err}`);
    }
  }
}

/** Minimal call shape needed for activity logging */
interface CallRecord {
  id: string;
  contactId?: string | null;
  userId?: string | null;
  direction: CallDirection;
  status: CallStatus;
  answeredAt?: Date | null;
  endedAt?: Date | null;
  recordingUrl?: string | null;
}
