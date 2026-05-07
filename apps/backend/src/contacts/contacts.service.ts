import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto, ImportContactsDto } from './dto/contact.dto';
import { normalizePhone, buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';

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

  async findAll(tenantId: string, page = 1, limit = 50, search?: string, label?: string) {
    const skip = getPaginationSkip(page, limit);

    const where: Record<string, unknown> = { tenantId };
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

    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.contact.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, tenantId } });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async findByPhone(tenantId: string, phone: string) {
    return this.prisma.contact.findUnique({
      where: { tenantId_phone: { tenantId, phone: normalizePhone(phone) } },
    });
  }

  async findOrCreate(tenantId: string, phone: string, name?: string) {
    const normalized = normalizePhone(phone);
    const existing = await this.findByPhone(tenantId, normalized);
    if (existing) return existing;

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
