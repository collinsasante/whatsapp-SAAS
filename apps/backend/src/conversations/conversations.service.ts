import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CreateConversationDto, UpdateConversationDto, CreateNoteDto, TransferConversationDto } from './dto/conversation.dto';
import { buildPaginationMeta, getPaginationSkip, normalizePhone } from '@whatsapp-platform/shared-utils';
import { ActivityAction, ConversationStatus, MessageDirection, MessageStatus, MessageType, QueueName, SnoozeWakeJob } from '@whatsapp-platform/shared-types';
import { NotificationType, ConversationEventType } from '@prisma/client';

const CHANNEL_SELECT = { select: { id: true, type: true, name: true } } as const;
const ASSIGNED_SELECT = { select: { id: true, name: true, avatarUrl: true, isAiAgent: true } } as const;
const CONV_INCLUDE = {
  contact: true,
  assignedTo: ASSIGNED_SELECT,
  channel: CHANNEL_SELECT,
} as const;

// SLA deadlines: minutes until breach per status
const SLA_MINUTES: Record<string, number> = {
  REQUESTED: 15,   // agent must intervene within 15 min
  INTERVENED: 120, // agent must resolve within 2 hours
};

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private activityLogService: ActivityLogService,
    private notificationsService: NotificationsService,
    private realtimeService: RealtimeService,
    private moduleRef: ModuleRef,
    @InjectQueue(QueueName.SNOOZE) private snoozeQueue: Queue,
  ) {}

  // ─── Finders ─────────────────────────────────────────────────────────────

  async findOrCreate(
    tenantId: string,
    contactId: string,
    source?: { contactSource?: string; adSourceId?: string; adHeadline?: string },
  ) {
    // Prefer active (non-resolved) conversation
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId, status: { not: 'RESOLVED' } },
      include: { contact: true, assignedTo: ASSIGNED_SELECT, channel: CHANNEL_SELECT },
    });
    if (existing) return existing;

    // Reopen most-recent resolved conversation
    const resolved = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId, status: 'RESOLVED' },
      orderBy: { updatedAt: 'desc' },
    });
    if (resolved) {
      const slaDeadline = new Date(Date.now() + SLA_MINUTES.REQUESTED * 60_000);
      const reopened = await this.prisma.conversation.update({
        where: { id: resolved.id },
        data: {
          status: ConversationStatus.REQUESTED,
          requestedAt: new Date(),
          slaDeadline,
          reopenedAt: new Date(),
          reopenedCount: { increment: 1 },
          resolvedAt: null,
          resolvedById: null,
          unreadCount: 0,
        },
        include: { contact: true, assignedTo: ASSIGNED_SELECT, channel: CHANNEL_SELECT },
      });
      await this.recordEvent(tenantId, resolved.id, ConversationEventType.REQUESTED);
      void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_REQUESTED, conversationId: resolved.id, contactId });
      this.realtimeService.emitConversationStateChanged(tenantId, resolved.id, reopened);
      void this.notifyAllAgents(tenantId, resolved.id, reopened as unknown as Record<string, unknown>, 'CONVERSATION_REQUESTED' as NotificationType);
      return reopened;
    }

    // Create fresh conversation
    const slaDeadline = new Date(Date.now() + SLA_MINUTES.REQUESTED * 60_000);
    const newConv = await this.prisma.conversation.create({
      data: {
        tenantId, contactId, status: ConversationStatus.REQUESTED, requestedAt: new Date(), slaDeadline,
        ...(source?.contactSource && { contactSource: source.contactSource }),
        ...(source?.adSourceId && { adSourceId: source.adSourceId }),
        ...(source?.adHeadline && { adHeadline: source.adHeadline }),
      },
      include: { contact: true, assignedTo: ASSIGNED_SELECT, channel: CHANNEL_SELECT },
    });
    await this.recordEvent(tenantId, newConv.id, ConversationEventType.REQUESTED);
    void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_REQUESTED, conversationId: newConv.id, contactId });
    this.realtimeService.emitConversationStateChanged(tenantId, newConv.id, newConv);
    void this.notifyAllAgents(tenantId, newConv.id, newConv as unknown as Record<string, unknown>, 'CONVERSATION_REQUESTED' as NotificationType);
    return newConv;
  }

  async create(tenantId: string, dto: CreateConversationDto, userId?: string) {
    const conversation = await this.prisma.conversation.create({
      data: { tenantId, contactId: dto.contactId, assignedToId: dto.assignedToId },
      include: { contact: true, assignedTo: ASSIGNED_SELECT, channel: CHANNEL_SELECT },
    });
    await this.recordEvent(tenantId, conversation.id, ConversationEventType.OPENED, userId);
    void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_CREATED, conversationId: conversation.id, contactId: conversation.contactId, userId });
    return conversation;
  }

  async findAll(
    tenantId: string,
    page = 1,
    limit = 25,
    status?: ConversationStatus,
    assignedToId?: string,
    search?: string,
  ) {
    const skip = getPaginationSkip(page, limit);
    const where: Record<string, unknown> = { tenantId };

    if (status) {
      where['status'] = status;
    } else {
      where['status'] = { notIn: ['RESOLVED'] };
    }
    if (assignedToId) where['assignedToId'] = assignedToId;

    const andClauses: unknown[] = [
      // Exclude snoozed conversations (hide until snooze expires)
      { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] },
    ];
    if (search) {
      andClauses.push({
        OR: [
          { contact: { name: { contains: search, mode: 'insensitive' } } },
          { contact: { phone: { contains: search } } },
          { messages: { some: { content: { contains: search, mode: 'insensitive' }, deletedForEveryone: false } } },
        ],
      });
    }
    where['AND'] = andClauses;

    const [data, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'desc' }, { lastMessageAt: 'desc' }],
        include: {
          contact: true,
          assignedTo: ASSIGNED_SELECT,
          channel: CHANNEL_SELECT,
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          activityLogs: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { action: true, metadata: true, createdAt: true },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    // Compute lastInboundAt per conversation for the 24h WhatsApp session timer
    const convIds = data.map((c) => c.id);
    const inboundMap = new Map<string, string>();
    if (convIds.length > 0) {
      const lastInbounds = await this.prisma.message.findMany({
        where: { conversationId: { in: convIds }, direction: 'INBOUND' },
        select: { conversationId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        distinct: ['conversationId'],
      });
      for (const m of lastInbounds) inboundMap.set(m.conversationId, m.createdAt.toISOString());
    }
    const dataWithSession = data.map((c) => ({ ...c, lastInboundAt: inboundMap.get(c.id) ?? null }));

    return { data: dataWithSession, meta: buildPaginationMeta(total, page, limit) };
  }

  async getStatusCounts(tenantId: string) {
    const counts = await this.prisma.conversation.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { id: true },
    });
    const result: Record<string, number> = { OPEN: 0, REQUESTED: 0, INTERVENED: 0, RESOLVED: 0 };
    for (const row of counts) {
      result[row.status] = row._count.id;
    }
    return result;
  }

  async findOne(tenantId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        contact: true,
        assignedTo: ASSIGNED_SELECT,
        channel: CHANNEL_SELECT,
        notes: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  // ─── State Machine ────────────────────────────────────────────────────────

  /** Customer requests human support → OPEN/INTERVENED → REQUESTED */
  async request(tenantId: string, id: string, reason?: string) {
    const existing = await this.findOne(tenantId, id);
    if (existing.status === ConversationStatus.REQUESTED) return existing;

    const slaDeadline = new Date(Date.now() + SLA_MINUTES.REQUESTED * 60_000);

    const result = await this.prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.REQUESTED,
        requestedAt: new Date(),
        slaDeadline,
      },
      include: CONV_INCLUDE,
    });

    await this.recordEvent(tenantId, id, ConversationEventType.REQUESTED, undefined, { reason });
    void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_REQUESTED, conversationId: id, contactId: existing.contactId });
    this.realtimeService.emitConversationStateChanged(tenantId, id, result);

    // Notify all agents in this tenant
    await this.notifyAllAgents(tenantId, id, result, 'CONVERSATION_REQUESTED' as NotificationType);
    return result;
  }

  /** Agent takes over chat → REQUESTED → INTERVENED */
  async intervene(tenantId: string, id: string, agentId: string) {
    const existing = await this.findOne(tenantId, id);

    if (existing.status !== ConversationStatus.REQUESTED) {
      throw new ForbiddenException('Only conversations with status REQUESTED can be intervened');
    }

    const slaDeadline = new Date(Date.now() + SLA_MINUTES.INTERVENED * 60_000);

    const result = await this.prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.INTERVENED,
        assignedToId: agentId,
        intervenedAt: new Date(),
        slaDeadline,
      },
      include: CONV_INCLUDE,
    });

    const agent = await this.prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });

    await this.recordEvent(tenantId, id, ConversationEventType.INTERVENED, agentId, { agentName: agent?.name ?? '' });
    void this.activityLogService.log({
      tenantId,
      action: ActivityAction.CONVERSATION_INTERVENED,
      conversationId: id,
      contactId: existing.contactId,
      userId: agentId,
      metadata: { agentName: agent?.name ?? '' },
    });
    this.realtimeService.emitConversationStateChanged(tenantId, id, result as unknown as Record<string, unknown>);
    return result;
  }

  /** Agent resolves conversation → INTERVENED/OPEN → RESOLVED */
  async resolve(tenantId: string, id: string, userId?: string) {
    const existing = await this.findOne(tenantId, id);

    const result = await this.prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedById: userId ?? null,
        slaDeadline: null,
      },
      include: CONV_INCLUDE,
    });

    await this.recordEvent(tenantId, id, ConversationEventType.RESOLVED, userId);
    void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_RESOLVED, conversationId: id, contactId: existing.contactId, userId });
    this.realtimeService.emitConversationStateChanged(tenantId, id, result);

    return result;
  }

  /** Manually reopen a resolved conversation → RESOLVED → OPEN (agent can reply immediately) */
  async reopen(tenantId: string, id: string, userId?: string) {
    const existing = await this.findOne(tenantId, id);

    const result = await this.prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.OPEN,
        reopenedAt: new Date(),
        reopenedCount: { increment: 1 },
        resolvedAt: null,
        resolvedById: null,
        slaDeadline: null,
        requestedAt: null,
      },
      include: CONV_INCLUDE,
    });

    void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_REOPENED, conversationId: id, contactId: existing.contactId, userId });
    this.realtimeService.emitConversationStateChanged(tenantId, id, result);
    return result;
  }

  /** Transfer to another agent */
  async transfer(tenantId: string, id: string, fromAgentId: string, dto: TransferConversationDto) {
    const existing = await this.findOne(tenantId, id);

    const result = await this.prisma.conversation.update({
      where: { id },
      data: { assignedToId: dto.toAgentId, status: ConversationStatus.REQUESTED },
      include: CONV_INCLUDE,
    });

    const [toAgent, fromAgent] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: dto.toAgentId }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { id: fromAgentId }, select: { name: true } }),
    ]);

    const transferMeta = { toAgentId: dto.toAgentId, toAgentName: toAgent?.name ?? '', fromAgentId, fromAgentName: fromAgent?.name ?? '', reason: dto.reason };
    await this.recordEvent(tenantId, id, ConversationEventType.TRANSFERRED, fromAgentId, transferMeta);
    void this.activityLogService.log({
      tenantId,
      action: ActivityAction.CONVERSATION_TRANSFERRED,
      conversationId: id,
      contactId: existing.contactId,
      userId: fromAgentId,
      metadata: transferMeta,
    });
    this.realtimeService.emitConversationStateChanged(tenantId, id, result);

    const contactName = (result.contact as { name?: string | null })?.name ?? (result.contact as { phone: string }).phone;
    void this.notificationsService.notifyUser(dto.toAgentId, tenantId, {
      type: NotificationType.CONVERSATION_ASSIGNED,
      title: 'Conversation transferred to you',
      body: `Chat with ${contactName} has been transferred to you`,
      link: `/inbox`,
      metadata: { conversationId: id },
    });

    return result;
  }

  // ─── Generic update (assign, label, snooze) ───────────────────────────────

  async update(tenantId: string, id: string, dto: UpdateConversationDto, userId?: string) {
    const existing = await this.findOne(tenantId, id);

    // Resolve snoozedUntil: explicit null clears, string sets, undefined leaves unchanged
    const snoozedUntilValue = 'snoozedUntil' in dto
      ? (dto.snoozedUntil ? new Date(dto.snoozedUntil) : null)
      : undefined;

    const result = await this.prisma.conversation.update({
      where: { id },
      data: {
        ...dto,
        snoozedUntil: snoozedUntilValue,
      },
      include: CONV_INCLUDE,
    });

    // Manage snooze queue job
    if ('snoozedUntil' in dto) {
      // Always remove any existing job first
      try {
        const pendingJob = await this.snoozeQueue.getJob(`snooze-${id}`);
        if (pendingJob) await pendingJob.remove();
      } catch { /* ignore */ }

      if (dto.snoozedUntil) {
        const delay = new Date(dto.snoozedUntil).getTime() - Date.now();
        if (delay > 0) {
          await this.snoozeQueue.add(
            'wake',
            { conversationId: id, tenantId } satisfies SnoozeWakeJob,
            { jobId: `snooze-${id}`, delay, removeOnComplete: true, removeOnFail: true },
          );
        }
        // Emit removal event so frontend hides this conversation immediately
        this.realtimeService.emitConversationSnoozed(tenantId, id);
      }
    }

    if (dto.status && (dto.status as string) !== (existing.status as string)) {
      const action = (dto.status as string) === 'RESOLVED' ? ActivityAction.CONVERSATION_RESOLVED
        : (dto.status as string) === 'REQUESTED' ? ActivityAction.CONVERSATION_REQUESTED
        : (dto.status as string) === 'ARCHIVED' ? ActivityAction.CONVERSATION_ARCHIVED
        : null;
      if (action) void this.activityLogService.log({ tenantId, action, conversationId: id, contactId: existing.contactId, userId });
    }
    if (dto.labels) {
      const oldLabels = (existing.labels as string[]) ?? [];
      const newLabels = dto.labels as string[];
      const added = newLabels.filter((l) => !oldLabels.includes(l));
      const removed = oldLabels.filter((l) => !newLabels.includes(l));
      for (const label of added) {
        void this.activityLogService.log({ tenantId, action: ActivityAction.TAG_ADDED, conversationId: id, contactId: existing.contactId, userId, metadata: { label } });
      }
      for (const label of removed) {
        void this.activityLogService.log({ tenantId, action: ActivityAction.TAG_REMOVED, conversationId: id, contactId: existing.contactId, userId, metadata: { label } });
      }
    }
    if ('assignedToId' in dto && dto.assignedToId) {
      void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_ASSIGNED, conversationId: id, contactId: existing.contactId, userId });
      if (dto.assignedToId !== userId) {
        const contactName = (result.contact as { name?: string | null })?.name ?? (result.contact as { phone: string }).phone;
        void this.notificationsService.notifyUser(dto.assignedToId, tenantId, {
          type: NotificationType.CONVERSATION_ASSIGNED,
          title: 'Conversation assigned to you',
          body: `A conversation with ${contactName} has been assigned to you`,
          link: `/inbox`,
          metadata: { conversationId: id },
        });
      }
    } else if ('assignedToId' in dto && !dto.assignedToId) {
      void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_UNASSIGNED, conversationId: id, contactId: existing.contactId, userId });
    }

    this.realtimeService.emitConversationUpdated(tenantId, id, result as Record<string, unknown>);
    return result;
  }

  // ─── Auto-reopen on inbound message ──────────────────────────────────────

  async autoReopenIfResolved(conversationId: string, tenantId: string, contactId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.status !== ConversationStatus.RESOLVED) return;

    const slaDeadline = new Date(Date.now() + SLA_MINUTES.REQUESTED * 60_000);
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: ConversationStatus.REQUESTED,
        requestedAt: new Date(),
        slaDeadline,
        reopenedAt: new Date(),
        reopenedCount: { increment: 1 },
        resolvedAt: null,
        resolvedById: null,
      },
    });

    await this.recordEvent(tenantId, conversationId, ConversationEventType.REQUESTED);
    void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_REQUESTED, conversationId, contactId });

    const updated = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: CONV_INCLUDE,
    });
    if (updated) this.realtimeService.emitConversationStateChanged(tenantId, conversationId, updated as Record<string, unknown>);
  }

  // ─── Other ───────────────────────────────────────────────────────────────

  async markRead(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const updated = await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    this.realtimeService.emitConversationUpdated(tenantId, id, { id, unreadCount: 0 });

    // Send read receipt to WhatsApp for the most recent inbound message with a valid wamid.
    // This is the correct point — an agent has just opened the conversation.
    const lastInbound = await this.prisma.message.findFirst({
      where: {
        conversationId: id,
        tenantId,
        direction: MessageDirection.INBOUND,
        whatsappMessageId: { startsWith: 'wamid.' },
      },
      orderBy: { createdAt: 'desc' },
      select: { whatsappMessageId: true },
    });
    if (lastInbound?.whatsappMessageId) {
      const waSvc = this.moduleRef.get(WhatsAppService, { strict: false });
      void waSvc.markMessageRead(tenantId, lastInbound.whatsappMessageId).catch(() => null);
    }

    return updated;
  }

  async markUnread(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const updated = await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 1 } });
    this.realtimeService.emitConversationUpdated(tenantId, id, { id, unreadCount: 1 });
    return updated;
  }

  async takeover(tenantId: string, id: string, agentId: string) {
    const existing = await this.findOne(tenantId, id);
    const slaDeadline = new Date(Date.now() + SLA_MINUTES.INTERVENED * 60_000);

    const result = await this.prisma.conversation.update({
      where: { id },
      data: {
        assignedToId: agentId,
        status: ConversationStatus.INTERVENED,
        intervenedAt: new Date(),
        slaDeadline,
      },
      include: CONV_INCLUDE,
    });

    const agent = await this.prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });
    await this.recordEvent(tenantId, id, ConversationEventType.INTERVENED, agentId, { agentName: agent?.name ?? '', takeover: true });
    void this.activityLogService.log({
      tenantId,
      action: ActivityAction.CONVERSATION_INTERVENED,
      conversationId: id,
      contactId: existing.contactId,
      userId: agentId,
      metadata: { agentName: agent?.name ?? '', takeover: true },
    });
    this.realtimeService.emitConversationStateChanged(tenantId, id, result as unknown as Record<string, unknown>);
    return result;
  }

  async addNote(tenantId: string, conversationId: string, authorId: string, dto: CreateNoteDto) {
    const conv = await this.findOne(tenantId, conversationId);
    const note = await this.prisma.conversationNote.create({
      data: { conversationId, authorId, content: dto.content },
      include: { author: { select: { id: true, name: true } } },
    });
    await this.recordEvent(tenantId, conversationId, ConversationEventType.NOTE_ADDED, authorId, { preview: dto.content.slice(0, 80) });
    void this.activityLogService.log({ tenantId, action: ActivityAction.NOTE_ADDED, conversationId, contactId: conv.contactId, userId: authorId });
    return note;
  }

  async getNotes(tenantId: string, conversationId: string) {
    await this.findOne(tenantId, conversationId);
    return this.prisma.conversationNote.findMany({
      where: { conversationId },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getEvents(tenantId: string, conversationId: string) {
    await this.findOne(tenantId, conversationId);
    return this.prisma.conversationEvent.findMany({
      where: { conversationId, tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteConversation(tenantId: string, conversationId: string) {
    await this.findOne(tenantId, conversationId);
    await this.prisma.message.deleteMany({ where: { conversationId, tenantId } });
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    return { success: true };
  }

  async incrementUnread(conversationId: string) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async recordEvent(
    tenantId: string,
    conversationId: string,
    type: ConversationEventType,
    actorId?: string,
    payload?: Record<string, unknown>,
  ) {
    return this.prisma.conversationEvent.create({
      data: {
        tenantId,
        conversationId,
        actorId: actorId ?? null,
        type,
        payload: (payload ?? {}) as object,
      },
    });
  }

  private async notifyAllAgents(
    tenantId: string,
    conversationId: string,
    conv: Record<string, unknown>,
    type: NotificationType,
  ) {
    const agents = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: ['ADMIN', 'AGENT'] } },
      select: { id: true },
    });
    const contactName = (conv.contact as { name?: string | null })?.name ?? (conv.contact as { phone: string })?.phone ?? 'Unknown';
    await Promise.all(
      agents.map((a) =>
        this.notificationsService.notifyUser(a.id, tenantId, {
          type,
          title: 'Customer requesting support',
          body: `${contactName} needs agent assistance`,
          link: `/inbox`,
          metadata: { conversationId },
        }),
      ),
    );
  }

  // ─── AI Summary ───────────────────────────────────────────────────────────

  async summarize(tenantId: string, conversationId: string) {
    const conversation = await this.findOne(tenantId, conversationId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, deletedForEveryone: false },
      orderBy: { createdAt: 'asc' },
      take: 150,
      select: { direction: true, content: true, type: true, createdAt: true },
    });

    const contactName = (conversation as unknown as { contact?: { name?: string; phone?: string } }).contact?.name
      ?? (conversation as unknown as { contact?: { phone?: string } }).contact?.phone
      ?? 'Customer';

    const transcript = messages
      .filter((m) => m.content)
      .map((m) => `[${m.direction === 'INBOUND' ? contactName : 'Agent'}]: ${m.content}`)
      .join('\n');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Rule-based fallback when no API key is configured
      const inbound = messages.filter((m) => m.direction === 'INBOUND').length;
      const outbound = messages.filter((m) => m.direction === 'OUTBOUND').length;
      const durationMs = messages.length > 1
        ? new Date(messages[messages.length - 1].createdAt).getTime() - new Date(messages[0].createdAt).getTime()
        : 0;
      const hours = Math.round(durationMs / 3600000);
      return {
        summary: `Conversation with ${contactName}: ${inbound + outbound} messages (${inbound} from customer, ${outbound} from agent) over ${hours > 0 ? hours + 'h' : 'less than 1h'}. Status: ${conversation.status}.`,
        note: 'Add ANTHROPIC_API_KEY to .env for full AI summary.',
      };
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Summarize this customer support conversation in 3-5 bullet points. Focus on: the issue raised, actions taken, and resolution status.\n\n${transcript}`,
        }],
      }),
    });

    const json = await resp.json() as { content?: Array<{ text?: string }> };
    const text = json.content?.[0]?.text ?? 'Could not generate summary.';
    return { summary: text };
  }

  // ─── CSV Import ───────────────────────────────────────────────────────────

  async importFromCsv(tenantId: string, csvText: string) {
    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV must have a header row and at least one data row');

    // Parse CSV header — match flexible column names
    const rawHeaders = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
    const col = (names: string[]) => {
      for (const n of names) {
        const idx = rawHeaders.findIndex((h) => h === n || h.includes(n));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idxPhone = col(['phone', 'phonenumber', 'mobilenumber', 'mobile', 'number', 'contact']);
    if (idxPhone === -1) throw new BadRequestException('CSV must have a "phone" or "phone number" column');

    const idxName    = col(['name', 'contactname', 'customername', 'fullname', 'firstname']);
    const idxDir     = col(['direction', 'messagedirection', 'type2', 'sentby', 'from']);
    const idxMsgType = col(['messagetype', 'type', 'mediatype']);
    const idxContent = col(['content', 'message', 'messagecontent', 'text', 'body']);
    const idxTs      = col(['timestamp', 'date', 'datetime', 'createdat', 'time', 'messagedate']);
    const idxMedia   = col(['mediaurl', 'media', 'fileurl', 'attachment', 'url']);
    const idxCaption = col(['caption', 'mediacaption']);

    let imported = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const rawPhone = cells[idxPhone]?.trim();
      if (!rawPhone) { skipped++; continue; }

      let phone: string;
      try { phone = normalizePhone(rawPhone); } catch { skipped++; continue; }

      const name   = idxName    !== -1 ? (cells[idxName]?.trim()    || undefined) : undefined;
      const dirRaw = idxDir     !== -1 ? (cells[idxDir]?.trim()?.toUpperCase()) : 'INBOUND';
      const dir: MessageDirection = dirRaw === 'OUTBOUND' || dirRaw === 'OUT' || dirRaw === 'AGENT' || dirRaw === 'BOT'
        ? MessageDirection.OUTBOUND : MessageDirection.INBOUND;
      const msgTypeRaw = idxMsgType !== -1 ? cells[idxMsgType]?.trim()?.toUpperCase() : 'TEXT';
      const msgType: MessageType =
        (['TEXT','IMAGE','VIDEO','AUDIO','DOCUMENT','LOCATION','CONTACTS'] as string[]).includes(msgTypeRaw ?? '')
          ? (msgTypeRaw as MessageType) : MessageType.TEXT;
      const content  = idxContent !== -1 ? (cells[idxContent]?.trim() || undefined) : undefined;
      const mediaUrl = idxMedia   !== -1 ? (cells[idxMedia]?.trim()   || undefined) : undefined;
      const caption  = idxCaption !== -1 ? (cells[idxCaption]?.trim() || undefined) : undefined;
      let createdAt  = new Date();
      if (idxTs !== -1 && cells[idxTs]?.trim()) {
        const parsed = new Date(cells[idxTs].trim());
        if (!isNaN(parsed.getTime())) createdAt = parsed;
      }

      try {
        // Upsert contact
        let contact = await this.prisma.contact.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
        if (!contact) {
          contact = await this.prisma.contact.create({ data: { tenantId, phone, name: name ?? null } });
        } else if (name && !contact.name) {
          contact = await this.prisma.contact.update({ where: { id: contact.id }, data: { name } });
        }

        // Find or create conversation (RESOLVED for imported)
        let conv = await this.prisma.conversation.findFirst({ where: { tenantId, contactId: contact.id }, orderBy: { createdAt: 'asc' } });
        if (!conv) {
          conv = await this.prisma.conversation.create({
            data: { tenantId, contactId: contact.id, status: ConversationStatus.RESOLVED, resolvedAt: new Date() },
          });
        }

        // Create message (skip if no content and no mediaUrl)
        if (!content && !mediaUrl) { skipped++; continue; }

        await this.prisma.message.create({
          data: {
            tenantId,
            conversationId: conv.id,
            contactId: contact.id,
            direction: dir,
            type: msgType,
            status: dir === MessageDirection.OUTBOUND ? MessageStatus.DELIVERED : MessageStatus.READ,
            content: content ?? null,
            mediaUrl: mediaUrl ?? null,
            mediaCaption: caption ?? null,
            createdAt,
            sentAt: dir === MessageDirection.OUTBOUND ? createdAt : null,
          },
        });

        // Update conversation's lastMessageAt
        await this.prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: createdAt } });
        imported++;
      } catch { skipped++; }
    }

    return { imported, skipped, total: lines.length - 1 };
  }

}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
