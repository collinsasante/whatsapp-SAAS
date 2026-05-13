import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateConversationDto, UpdateConversationDto, CreateNoteDto, TransferConversationDto } from './dto/conversation.dto';
import { buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';
import { ActivityAction, ConversationStatus } from '@whatsapp-platform/shared-types';
import { NotificationType, ConversationEventType } from '@prisma/client';

const CHANNEL_SELECT = { select: { id: true, type: true, name: true } } as const;
const ASSIGNED_SELECT = { select: { id: true, name: true, avatarUrl: true } } as const;
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
  ) {}

  // ─── Finders ─────────────────────────────────────────────────────────────

  async findOrCreate(tenantId: string, contactId: string) {
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
      data: { tenantId, contactId, status: ConversationStatus.REQUESTED, requestedAt: new Date(), slaDeadline },
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
    if (search) {
      where['contact'] = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      };
    }

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
    const result: Record<string, number> = { REQUESTED: 0, INTERVENED: 0, RESOLVED: 0 };
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

  /** Manually reopen a resolved conversation → RESOLVED → REQUESTING */
  async reopen(tenantId: string, id: string, userId?: string) {
    const existing = await this.findOne(tenantId, id);

    const slaDeadline = new Date(Date.now() + SLA_MINUTES.REQUESTED * 60_000);
    const result = await this.prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.REQUESTED,
        requestedAt: new Date(),
        slaDeadline,
        reopenedAt: new Date(),
        reopenedCount: { increment: 1 },
        resolvedAt: null,
        resolvedById: null,
      },
      include: CONV_INCLUDE,
    });

    await this.recordEvent(tenantId, id, ConversationEventType.REQUESTED, userId);
    void this.activityLogService.log({ tenantId, action: ActivityAction.CONVERSATION_REOPENED, conversationId: id, contactId: existing.contactId, userId });
    this.realtimeService.emitConversationStateChanged(tenantId, id, result);
    void this.notifyAllAgents(tenantId, id, result as unknown as Record<string, unknown>, 'CONVERSATION_REQUESTED' as NotificationType);
    return result;
  }

  /** Transfer to another agent */
  async transfer(tenantId: string, id: string, fromAgentId: string, dto: TransferConversationDto) {
    const existing = await this.findOne(tenantId, id);

    const result = await this.prisma.conversation.update({
      where: { id },
      data: { assignedToId: dto.toAgentId },
      include: CONV_INCLUDE,
    });

    const toAgent = await this.prisma.user.findUnique({ where: { id: dto.toAgentId }, select: { name: true } });

    await this.recordEvent(tenantId, id, ConversationEventType.TRANSFERRED, fromAgentId, { fromAgentId, toAgentId: dto.toAgentId, toAgentName: toAgent?.name ?? '', reason: dto.reason });
    void this.activityLogService.log({
      tenantId,
      action: ActivityAction.CONVERSATION_TRANSFERRED,
      conversationId: id,
      contactId: existing.contactId,
      userId: fromAgentId,
      metadata: { toAgentId: dto.toAgentId, toAgentName: toAgent?.name ?? '', fromAgentId, reason: dto.reason },
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
    const result = await this.prisma.conversation.update({
      where: { id },
      data: {
        ...dto,
        snoozedUntil: dto.snoozedUntil ? new Date(dto.snoozedUntil) : undefined,
      },
      include: CONV_INCLUDE,
    });

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
    return this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
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
}
