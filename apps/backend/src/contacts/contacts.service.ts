import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto, ImportContactsDto } from './dto/contact.dto';
import { normalizePhone, buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';
import { buildContactWhere, SegmentFilter } from '../segments/segments.service';

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

    for (const contactDto of dto.contacts) {
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
    }

    return results;
  }
}
