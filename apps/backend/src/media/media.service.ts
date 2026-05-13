import { Injectable, NotFoundException } from '@nestjs/common';
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

  async getStream(fileKey: string) {
    return this.storageService.getStream(fileKey);
  }

  async getStreamWithMime(fileKey: string): Promise<{ stream: NodeJS.ReadableStream | null; mimeType: string | null }> {
    const [stream, asset] = await Promise.all([
      this.storageService.getStream(fileKey),
      this.prisma.mediaAsset.findFirst({ where: { fileKey }, select: { mimeType: true } }),
    ]);
    return { stream, mimeType: asset?.mimeType ?? null };
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
