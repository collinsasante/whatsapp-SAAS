import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';

const MIME_TO_MEDIA_TYPE: Record<string, 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT'> = {
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/gif': 'IMAGE',
  'image/webp': 'IMAGE',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
  'audio/mpeg': 'AUDIO',
  'audio/ogg': 'AUDIO',
  'audio/wav': 'AUDIO',
  'application/pdf': 'DOCUMENT',
  'application/msword': 'DOCUMENT',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCUMENT',
};

@Injectable()
export class MediaService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async upload(tenantId: string, uploadedById: string, file: Express.Multer.File) {
    const existing = await this.prisma.mediaAsset.findFirst({
      where: { tenantId, originalName: file.originalname },
    });
    if (existing) {
      throw new BadRequestException(`A file named "${file.originalname}" already exists in your library`);
    }

    const { fileKey, fileUrl } = await this.storageService.upload(file, tenantId);

    const mediaType = MIME_TO_MEDIA_TYPE[file.mimetype] ?? 'DOCUMENT';

    return this.prisma.mediaAsset.create({
      data: {
        tenantId,
        uploadedById,
        type: mediaType,
        originalName: file.originalname,
        fileKey,
        fileUrl,
        mimeType: file.mimetype,
        fileSize: file.size,
      },
    });
  }

  async findAll(tenantId: string, page = 1, limit = 50) {
    const skip = getPaginationSkip(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where: { tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { uploadedBy: { select: { name: true } } },
      }),
      this.prisma.mediaAsset.count({ where: { tenantId } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(tenantId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException('Media asset not found');
    return asset;
  }

  async remove(tenantId: string, id: string) {
    const asset = await this.findOne(tenantId, id);
    await this.storageService.delete(asset.fileKey);
    await this.prisma.mediaAsset.delete({ where: { id } });
  }

  async deduplicateAssets(tenantId: string): Promise<{ removed: number }> {
    const all = await this.prisma.mediaAsset.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, originalName: true, fileKey: true },
    });
    const seen = new Map<string, boolean>();
    const toDelete: { id: string; fileKey: string }[] = [];
    for (const asset of all) {
      if (seen.has(asset.originalName)) {
        toDelete.push({ id: asset.id, fileKey: asset.fileKey });
      } else {
        seen.set(asset.originalName, true);
      }
    }
    if (toDelete.length === 0) return { removed: 0 };
    await Promise.all([
      ...toDelete.map((a) => this.storageService.delete(a.fileKey).catch(() => {})),
      this.prisma.mediaAsset.deleteMany({ where: { id: { in: toDelete.map((a) => a.id) } } }),
    ]);
    return { removed: toDelete.length };
  }

  async getStreamWithMime(fileKey: string): Promise<{ stream: NodeJS.ReadableStream | null; mimeType: string | null }> {
    const [storageResult, asset] = await Promise.all([
      this.storageService.getStreamWithMime(fileKey),
      this.prisma.mediaAsset.findFirst({ where: { fileKey }, select: { mimeType: true } }),
    ]);
    // Storage-level Content-Type (set at upload time) covers every file, including
    // inbound WhatsApp media which never gets a MediaAsset row. The MediaAsset lookup
    // is only a fallback for older objects written before this was tracked in storage.
    return { stream: storageResult.stream, mimeType: storageResult.mimeType ?? asset?.mimeType ?? null };
  }

  async findMessageMedia(tenantId: string, page = 1, limit = 50, type?: string, search?: string) {
    const skip = getPaginationSkip(page, limit);
    const allowedTypes = ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'];
    const typeFilter = type && allowedTypes.includes(type) ? [type] : allowedTypes;

    const where: Prisma.MessageWhereInput = {
      tenantId,
      mediaUrl: { not: null },
      type: { in: typeFilter as Prisma.EnumMessageTypeFilter['in'] },
    };

    if (search) {
      where.OR = [
        { contact: { name: { contains: search, mode: 'insensitive' } } },
        { mediaCaption: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [raw, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        skip,
        take: limit * 3, // fetch extra to account for dedup
        orderBy: { createdAt: 'desc' },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          conversation: { select: { id: true } },
        },
      }),
      this.prisma.message.count({ where }),
    ]);

    // Deduplicate by mediaUrl — keep most recent per URL
    const seen = new Set<string>();
    const data = raw.filter((m) => {
      if (!m.mediaUrl) return false;
      if (seen.has(m.mediaUrl)) return false;
      seen.add(m.mediaUrl);
      return true;
    }).slice(0, limit);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }
}
