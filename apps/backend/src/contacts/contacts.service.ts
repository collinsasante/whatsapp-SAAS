import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto, ImportContactsDto } from './dto/contact.dto';
import { normalizePhone, buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';
import { buildContactWhere, SegmentFilter } from '../segments/segments.service';

type DatePreset = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month';

function getDateRangeForPreset(preset: DatePreset): { gte: Date; lte: Date } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  switch (preset) {
    case 'today':
      return { gte: startOfDay(now), lte: endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { gte: startOfDay(y), lte: endOfDay(y) };
    }
    case 'this_week': {
      const day = now.getDay();
      const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
      return { gte: startOfDay(mon), lte: endOfDay(now) };
    }
    case 'last_week': {
      const day = now.getDay();
      const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - ((day + 6) % 7));
      const lastMon = new Date(thisMonday); lastMon.setDate(thisMonday.getDate() - 7);
      const lastSun = new Date(thisMonday); lastSun.setDate(thisMonday.getDate() - 1);
      return { gte: startOfDay(lastMon), lte: endOfDay(lastSun) };
    }
    case 'this_month':
      return { gte: new Date(now.getFullYear(), now.getMonth(), 1), lte: endOfDay(now) };
    case 'last_month': {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastOfPrev = new Date(firstOfMonth); lastOfPrev.setDate(0);
      return { gte: new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1), lte: endOfDay(lastOfPrev) };
    }
  }
}

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateContactDto) {
    const phone = normalizePhone(dto.phone);

    const existing = await this.prisma.contact.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    if (existing) throw new ConflictException('Contact with this phone already exists');

    return this.prisma.contact.create({
      data: {
        tenantId,
        phone,
        name: dto.name,
        email: dto.email,
        labels: dto.labels ?? [],
        customFields: dto.customFields ?? {},
      },
    });
  }

  async findAll(
    tenantId: string,
    page = 1,
    limit = 50,
    search?: string,
    label?: string,
    segmentId?: string,
    isBlocked?: boolean,
    optedOut?: boolean,
    dateField?: 'createdAt' | 'lastMessage' | 'lastActive',
    datePreset?: DatePreset,
    dateFrom?: string,
    dateTo?: string,
    assignedAgentId?: string,
    conversationStatus?: string,
  ) {
    const skip = getPaginationSkip(page, limit);

    let where: Record<string, unknown> = { tenantId };

    if (segmentId) {
      const segment = await this.prisma.contactSegment.findFirst({ where: { id: segmentId, tenantId } });
      if (segment) {
        const filters = segment.filters as unknown as SegmentFilter[];
        where = buildContactWhere(tenantId, filters) as Record<string, unknown>;
      }
    }

    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (label) {
      where['labels'] = { has: label };
    }
    if (isBlocked !== undefined) {
      where['isBlocked'] = isBlocked;
    }
    if (optedOut !== undefined) {
      where['optedOut'] = optedOut;
    }

    // Date filtering
    if (dateField && (datePreset || (dateFrom || dateTo))) {
      const range = datePreset
        ? getDateRangeForPreset(datePreset)
        : { gte: dateFrom ? new Date(dateFrom) : undefined, lte: dateTo ? new Date(dateTo) : undefined };

      const rangeFilter: Record<string, unknown> = {};
      if (range.gte) rangeFilter['gte'] = range.gte;
      if (range.lte) rangeFilter['lte'] = range.lte;

      if (dateField === 'createdAt') {
        where['createdAt'] = rangeFilter;
      } else if (dateField === 'lastMessage') {
        where['conversations'] = { some: { lastMessageAt: rangeFilter } };
      } else if (dateField === 'lastActive') {
        where['conversations'] = { some: { updatedAt: rangeFilter } };
      }
    }

    // Assigned agent filter
    if (assignedAgentId) {
      const convFilter = (where['conversations'] as Record<string, unknown> | undefined) ?? {};
      const existingSome = (convFilter['some'] as Record<string, unknown> | undefined) ?? {};
      where['conversations'] = { some: { ...existingSome, assignedToId: assignedAgentId } };
    }

    // Conversation status filter
    if (conversationStatus) {
      const convFilter = (where['conversations'] as Record<string, unknown> | undefined) ?? {};
      const existingSome = (convFilter['some'] as Record<string, unknown> | undefined) ?? {};
      where['conversations'] = { some: { ...existingSome, status: conversationStatus } };
    }

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
        include: {
          conversations: {
            take: 1,
            orderBy: { updatedAt: 'desc' },
            include: {
              assignedTo: { select: { id: true, name: true, avatarUrl: true } },
              channel: { select: { id: true, name: true, type: true } },
              messages: {
                take: 1,
                orderBy: { createdAt: 'desc' },
                select: { id: true, content: true, type: true, direction: true, createdAt: true, mediaCaption: true },
              },
            },
          },
        },
      }),
      this.prisma.contact.count({ where }),
    ]);

    const data = contacts.map(({ conversations, ...contact }) => ({
      ...contact,
      latestConversation: conversations[0] ?? null,
    }));

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId },
      include: {
        conversations: {
          take: 1,
          orderBy: { updatedAt: 'desc' },
          include: {
            assignedTo: { select: { id: true, name: true, avatarUrl: true } },
            channel: { select: { id: true, name: true, type: true } },
          },
        },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const { conversations, ...rest } = contact;
    return { ...rest, latestConversation: conversations[0] ?? null };
  }

  async findByPhone(tenantId: string, phone: string) {
    return this.prisma.contact.findUnique({
      where: { tenantId_phone: { tenantId, phone: normalizePhone(phone) } },
    });
  }

  async findOrCreate(tenantId: string, phone: string, name?: string) {
    const normalized = normalizePhone(phone);
    const existing = await this.findByPhone(tenantId, normalized);

    if (existing) {
      // Update name from WhatsApp profile if we have one and the contact has none
      if (name && !existing.name) {
        return this.prisma.contact.update({
          where: { id: existing.id },
          data: { name },
        });
      }
      return existing;
    }

    return this.prisma.contact.create({
      data: { tenantId, phone: normalized, name: name ?? null },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateContactDto) {
    await this.findOne(tenantId, id);
    return this.prisma.contact.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const convIds = (await this.prisma.conversation.findMany({ where: { tenantId, contactId: id }, select: { id: true } })).map(c => c.id);
    await this.prisma.campaignRecipient.deleteMany({ where: { contactId: id } });
    await this.prisma.callLog.deleteMany({ where: { contactId: id } });
    if (convIds.length) {
      await this.prisma.conversationNote.deleteMany({ where: { conversationId: { in: convIds } } });
      await this.prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
      await this.prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
    }
    await this.prisma.contact.delete({ where: { id } });
  }

  async bulkImport(tenantId: string, dto: ImportContactsDto) {
    const results = { created: 0, skipped: 0, errors: [] as string[] };
    const BATCH = 50;

    for (let i = 0; i < dto.contacts.length; i += BATCH) {
      await Promise.all(
        dto.contacts.slice(i, i + BATCH).map(async (contactDto) => {
          try {
            const phone = normalizePhone(contactDto.phone);
            await this.prisma.contact.upsert({
              where: { tenantId_phone: { tenantId, phone } },
              create: { tenantId, phone, name: contactDto.name, email: contactDto.email, labels: contactDto.labels ?? [] },
              update: { name: contactDto.name, email: contactDto.email },
            });
            results.created++;
          } catch {
            results.errors.push(`Failed to import ${contactDto.phone}`);
            results.skipped++;
          }
        }),
      );
    }

    return results;
  }

  async toggleBlock(tenantId: string, id: string) {
    const contact = await this.prisma.contact.findFirstOrThrow({ where: { id, tenantId }, select: { id: true, isBlocked: true } });
    return this.prisma.contact.update({
      where: { id },
      data: { isBlocked: !contact.isBlocked },
      select: { id: true, isBlocked: true },
    });
  }

  async getTimeline(tenantId: string, contactId: string, limit = 50) {
    await this.findOne(tenantId, contactId);

    const [activities, conversations, campaigns] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: {
          tenantId,
          OR: [{ contactId }, { entityId: contactId }],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),

      this.prisma.conversation.findMany({
        where: { tenantId, contactId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, status: true, createdAt: true, updatedAt: true,
          csatScore: true, slaDeadline: true,
          assignedTo: { select: { id: true, name: true, avatarUrl: true } },
          resolvedBy: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      }),

      this.prisma.campaignRecipient.findMany({
        where: { contact: { id: contactId, tenantId } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          status: true, sentAt: true, deliveredAt: true, readAt: true, failedAt: true,
          campaign: { select: { id: true, name: true, status: true, createdAt: true } },
        },
      }),
    ]);

    return { activities, conversations, campaigns };
  }
}
