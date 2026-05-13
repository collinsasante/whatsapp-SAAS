import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCannedDto {
  shortcut: string;
  content: string;
  category?: string;
}

export interface UpdateCannedDto {
  shortcut?: string;
  content?: string;
  category?: string;
}

@Injectable()
export class CannedResponsesService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.cannedResponse.findMany({
      where: { tenantId },
      orderBy: { shortcut: 'asc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  search(tenantId: string, q: string) {
    return this.prisma.cannedResponse.findMany({
      where: {
        tenantId,
        OR: [
          { shortcut: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { shortcut: 'asc' },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateCannedDto) {
    return this.prisma.cannedResponse.create({
      data: { tenantId, createdById: userId, ...dto },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateCannedDto) {
    const existing = await this.prisma.cannedResponse.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Canned response not found');
    return this.prisma.cannedResponse.update({ where: { id }, data: dto });
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.cannedResponse.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Canned response not found');
    return this.prisma.cannedResponse.delete({ where: { id } });
  }
}
