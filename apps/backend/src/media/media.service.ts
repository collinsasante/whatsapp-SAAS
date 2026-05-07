import { Injectable, NotFoundException } from '@nestjs/common';
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
}
