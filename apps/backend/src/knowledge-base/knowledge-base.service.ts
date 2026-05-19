import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KnowledgeBaseService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.knowledgeBaseArticle.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, data: { title: string; content: string; isActive?: boolean }) {
    return this.prisma.knowledgeBaseArticle.create({
      data: { tenantId, ...data },
    });
  }

  async update(tenantId: string, id: string, data: { title?: string; content?: string; isActive?: boolean }) {
    const article = await this.prisma.knowledgeBaseArticle.findFirst({ where: { id, tenantId } });
    if (!article) throw new NotFoundException('Article not found');
    return this.prisma.knowledgeBaseArticle.update({ where: { id }, data });
  }

  async remove(tenantId: string, id: string) {
    const article = await this.prisma.knowledgeBaseArticle.findFirst({ where: { id, tenantId } });
    if (!article) throw new NotFoundException('Article not found');
    await this.prisma.knowledgeBaseArticle.delete({ where: { id } });
  }

  async getActive(tenantId: string) {
    return this.prisma.knowledgeBaseArticle.findMany({
      where: { tenantId, isActive: true },
      select: { title: true, content: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
