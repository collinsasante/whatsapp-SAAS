import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface SegmentFilter {
  field: string;
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'has' | 'notHas' | 'isTrue' | 'isFalse';
  value: string;
}

export function buildContactWhere(tenantId: string, filters: SegmentFilter[]): Prisma.ContactWhereInput {
  const insensitive = Prisma.QueryMode.insensitive;
  const conditions: Prisma.ContactWhereInput[] = filters.map(f => {
    switch (f.field) {
      case 'name':
        if (f.operator === 'contains') return { name: { contains: f.value, mode: insensitive } };
        if (f.operator === 'startsWith') return { name: { startsWith: f.value, mode: insensitive } };
        return { name: { equals: f.value, mode: insensitive } };
      case 'phone':
        return { phone: { contains: f.value } };
      case 'email':
        if (f.operator === 'contains') return { email: { contains: f.value, mode: insensitive } };
        return { email: { equals: f.value, mode: insensitive } };
      case 'label':
        if (f.operator === 'notHas') return { NOT: { labels: { has: f.value } } };
        return { labels: { has: f.value } };
      case 'optedOut':
        return { optedOut: f.operator === 'isTrue' };
      case 'isBlocked':
        return { isBlocked: f.operator === 'isTrue' };
      default:
        return {};
    }
  }).filter(c => Object.keys(c).length > 0);

  return { tenantId, ...(conditions.length > 0 ? { AND: conditions } : {}) };
}

@Injectable()
export class SegmentsService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.contactSegment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(tenantId: string, data: { name: string; description?: string; filters: SegmentFilter[] }) {
    const segment = await this.prisma.contactSegment.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description,
        filters: data.filters as unknown as Prisma.InputJsonValue,
      },
    });
    const count = await this.prisma.contact.count({
      where: buildContactWhere(tenantId, data.filters),
    });
    return this.prisma.contactSegment.update({
      where: { id: segment.id },
      data: { contactCount: count },
    });
  }

  async update(id: string, tenantId: string, data: { name?: string; description?: string; filters?: SegmentFilter[] }) {
    const seg = await this.prisma.contactSegment.findFirst({ where: { id, tenantId } });
    if (!seg) throw new NotFoundException('Segment not found');

    const filters = (data.filters ?? seg.filters) as unknown as SegmentFilter[];
    const count = await this.prisma.contact.count({
      where: buildContactWhere(tenantId, filters),
    });

    return this.prisma.contactSegment.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.filters && { filters: data.filters as unknown as Prisma.InputJsonValue }),
        contactCount: count,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    const seg = await this.prisma.contactSegment.findFirst({ where: { id, tenantId } });
    if (!seg) throw new NotFoundException('Segment not found');
    return this.prisma.contactSegment.delete({ where: { id } });
  }

  async refreshCount(id: string, tenantId: string) {
    const seg = await this.prisma.contactSegment.findFirst({ where: { id, tenantId } });
    if (!seg) throw new NotFoundException('Segment not found');
    const filters = seg.filters as unknown as SegmentFilter[];
    const count = await this.prisma.contact.count({
      where: buildContactWhere(tenantId, filters),
    });
    return this.prisma.contactSegment.update({ where: { id }, data: { contactCount: count } });
  }
}
