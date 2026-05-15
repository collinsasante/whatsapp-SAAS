import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface CreateCannedDto {
  title?: string;
  shortcut: string;
  content: string;
  categoryId?: string;
  tags?: string[];
  mediaUrl?: string;
  mediaType?: string;
}

export interface UpdateCannedDto {
  title?: string;
  shortcut?: string;
  content?: string;
  categoryId?: string | null;
  tags?: string[];
  mediaUrl?: string | null;
  mediaType?: string | null;
}

export interface CreateCategoryDto {
  name: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
}

export interface UpdateCategoryDto {
  name?: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
}

const includeRelations = (userId: string) => ({
  createdBy: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, color: true, icon: true } },
  favorites: { where: { userId }, select: { id: true } },
  _count: { select: { usages: true } },
});

@Injectable()
export class CannedResponsesService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  // ── Categories ────────────────────────────────────────────────────────────

  listCategories(tenantId: string) {
    return this.prisma.cannedResponseCategory.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { cannedResponses: true } } },
    });
  }

  async createCategory(tenantId: string, dto: CreateCategoryDto) {
    const cat = await this.prisma.cannedResponseCategory.create({
      data: { tenantId, ...dto },
    });
    this.realtime.emitCannedUpdated(tenantId);
    return cat;
  }

  async updateCategory(id: string, tenantId: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.cannedResponseCategory.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Category not found');
    const cat = await this.prisma.cannedResponseCategory.update({ where: { id }, data: dto });
    this.realtime.emitCannedUpdated(tenantId);
    return cat;
  }

  async deleteCategory(id: string, tenantId: string) {
    const existing = await this.prisma.cannedResponseCategory.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Category not found');
    // Null out category on responses
    await this.prisma.cannedResponse.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
    await this.prisma.cannedResponseCategory.delete({ where: { id } });
    this.realtime.emitCannedUpdated(tenantId);
    return { success: true };
  }

  // ── Canned Responses ──────────────────────────────────────────────────────

  async list(tenantId: string, userId: string) {
    const items = await this.prisma.cannedResponse.findMany({
      where: { tenantId },
      orderBy: [{ usageCount: 'desc' }, { shortcut: 'asc' }],
      include: includeRelations(userId),
    });
    return items.map((r) => ({ ...r, isFavorite: r.favorites.length > 0 }));
  }

  async search(tenantId: string, userId: string, q: string, categoryId?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (categoryId) where.categoryId = categoryId;
    if (q) {
      where.OR = [
        { shortcut: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ];
    }
    const items = await this.prisma.cannedResponse.findMany({
      where,
      take: 20,
      orderBy: [{ usageCount: 'desc' }, { shortcut: 'asc' }],
      include: includeRelations(userId),
    });
    return items.map((r) => ({ ...r, isFavorite: r.favorites.length > 0 }));
  }

  async getFavorites(tenantId: string, userId: string) {
    const items = await this.prisma.cannedResponse.findMany({
      where: { tenantId, favorites: { some: { userId } } },
      orderBy: { shortcut: 'asc' },
      include: includeRelations(userId),
    });
    return items.map((r) => ({ ...r, isFavorite: true }));
  }

  async getRecent(tenantId: string, userId: string) {
    const usages = await this.prisma.cannedResponseUsage.findMany({
      where: { tenantId, userId },
      orderBy: { usedAt: 'desc' },
      take: 10,
      distinct: ['cannedResponseId'],
      include: {
        cannedResponse: { include: includeRelations(userId) },
      },
    });
    return usages
      .filter((u) => u.cannedResponse)
      .map((u) => ({ ...u.cannedResponse, isFavorite: u.cannedResponse.favorites.length > 0 }));
  }

  async create(tenantId: string, userId: string, dto: CreateCannedDto) {
    const item = await this.prisma.cannedResponse.create({
      data: { tenantId, createdById: userId, title: dto.title ?? '', ...dto },
      include: includeRelations(userId),
    });
    this.realtime.emitCannedUpdated(tenantId);
    return { ...item, isFavorite: false };
  }

  async update(id: string, tenantId: string, userId: string, dto: UpdateCannedDto) {
    const existing = await this.prisma.cannedResponse.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Canned response not found');
    const item = await this.prisma.cannedResponse.update({
      where: { id },
      data: dto,
      include: includeRelations(userId),
    });
    this.realtime.emitCannedUpdated(tenantId);
    return { ...item, isFavorite: item.favorites.length > 0 };
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.cannedResponse.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Canned response not found');
    await this.prisma.cannedResponse.delete({ where: { id } });
    this.realtime.emitCannedUpdated(tenantId);
    return { success: true };
  }

  async toggleFavorite(id: string, tenantId: string, userId: string) {
    const existing = await this.prisma.cannedResponse.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Canned response not found');
    const fav = await this.prisma.userFavoriteResponse.findUnique({
      where: { userId_cannedResponseId: { userId, cannedResponseId: id } },
    });
    if (fav) {
      await this.prisma.userFavoriteResponse.delete({
        where: { userId_cannedResponseId: { userId, cannedResponseId: id } },
      });
      return { isFavorite: false };
    } else {
      await this.prisma.userFavoriteResponse.create({
        data: { userId, cannedResponseId: id },
      });
      return { isFavorite: true };
    }
  }

  async trackUsage(id: string, tenantId: string, userId: string) {
    const existing = await this.prisma.cannedResponse.findFirst({ where: { id, tenantId } });
    if (!existing) return;
    await this.prisma.$transaction([
      this.prisma.cannedResponseUsage.create({
        data: { userId, tenantId, cannedResponseId: id },
      }),
      this.prisma.cannedResponse.update({
        where: { id },
        data: { usageCount: { increment: 1 } },
      }),
    ]);
  }
}
