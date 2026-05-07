import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConversationDto, UpdateConversationDto, CreateNoteDto } from './dto/conversation.dto';
import { buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';
import { ConversationStatus } from '@whatsapp-platform/shared-types';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async findOrCreate(tenantId: string, contactId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId, status: { not: 'RESOLVED' } },
      include: { contact: true, assignedTo: { select: { id: true, name: true, avatarUrl: true } } },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { tenantId, contactId },
      include: { contact: true, assignedTo: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async create(tenantId: string, dto: CreateConversationDto) {
    return this.prisma.conversation.create({
      data: { tenantId, contactId: dto.contactId, assignedToId: dto.assignedToId },
      include: { contact: true, assignedTo: { select: { id: true, name: true, avatarUrl: true } } },
    });
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

    if (status) where['status'] = status;
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
        orderBy: { lastMessageAt: 'desc' },
        include: {
          contact: true,
          assignedTo: { select: { id: true, name: true, avatarUrl: true } },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        contact: true,
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        notes: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async update(tenantId: string, id: string, dto: UpdateConversationDto) {
    await this.findOne(tenantId, id);
    return this.prisma.conversation.update({
      where: { id },
      data: {
        ...dto,
        snoozedUntil: dto.snoozedUntil ? new Date(dto.snoozedUntil) : undefined,
      },
      include: {
        contact: true,
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async resolve(tenantId: string, id: string) {
    return this.update(tenantId, id, { status: ConversationStatus.RESOLVED });
  }

  async markRead(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });
  }

  async addNote(tenantId: string, conversationId: string, authorId: string, dto: CreateNoteDto) {
    await this.findOne(tenantId, conversationId);
    return this.prisma.conversationNote.create({
      data: { conversationId, authorId, content: dto.content },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async incrementUnread(conversationId: string) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        unreadCount: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });
  }
}
