import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributeType } from '@prisma/client';

export interface CreateAttributeDto {
  key: string;
  label: string;
  type?: AttributeType;
  options?: string[];
  isRequired?: boolean;
  sortOrder?: number;
}

@Injectable()
export class AttributesService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.contactAttribute.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  create(tenantId: string, dto: CreateAttributeDto) {
    return this.prisma.contactAttribute.create({
      data: {
        tenantId,
        key: dto.key.toLowerCase().replace(/\s+/g, '_'),
        label: dto.label,
        type: dto.type ?? 'TEXT',
        options: dto.options ?? [],
        isRequired: dto.isRequired ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, tenantId: string, dto: Partial<CreateAttributeDto>) {
    const attr = await this.prisma.contactAttribute.findFirst({ where: { id, tenantId } });
    if (!attr) throw new NotFoundException('Attribute not found');
    return this.prisma.contactAttribute.update({
      where: { id },
      data: {
        ...(dto.label && { label: dto.label }),
        ...(dto.options && { options: dto.options }),
        ...(dto.isRequired !== undefined && { isRequired: dto.isRequired }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async remove(id: string, tenantId: string) {
    const attr = await this.prisma.contactAttribute.findFirst({ where: { id, tenantId } });
    if (!attr) throw new NotFoundException('Attribute not found');
    return this.prisma.contactAttribute.delete({ where: { id } });
  }
}
