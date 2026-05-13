import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TagsService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.tag.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, name: string, color = '#0d9488') {
    try {
      return await this.prisma.tag.create({ data: { tenantId, name: name.trim(), color } });
    } catch {
      throw new ConflictException(`Tag "${name}" already exists`);
    }
  }

  async update(id: string, tenantId: string, data: { name?: string; color?: string }) {
    const tag = await this.prisma.tag.findFirst({ where: { id, tenantId } });
    if (!tag) throw new NotFoundException('Tag not found');
    return this.prisma.tag.update({ where: { id }, data });
  }

  async remove(id: string, tenantId: string) {
    const tag = await this.prisma.tag.findFirst({ where: { id, tenantId } });
    if (!tag) throw new NotFoundException('Tag not found');
    return this.prisma.tag.delete({ where: { id } });
  }
}
