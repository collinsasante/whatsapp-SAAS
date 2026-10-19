import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { buildMediaWhere, MEDIA_JOINS, MediaLibraryFilters, normalizeMediaFilters } from './media-library.query';
import { buildPaginationMeta, getPaginationSkip } from '@whatsapp-platform/shared-utils';

// Also acts as the upload allowlist (see upload() below) -- any mimetype not
// listed here is rejected outright, not just miscategorized as a generic
// DOCUMENT. Without this, an authenticated Admin/Agent could upload an
// .html/.svg file, have it served back with a matching Content-Type from
// the same origin, and use it for stored XSS (GET /media/serve/:fileKey is
// @Public() and echoes the stored mimeType verbatim).
const MIME_TO_MEDIA_TYPE: Record<string, 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT'> = {
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/gif': 'IMAGE',
  'image/webp': 'IMAGE',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
  'video/quicktime': 'VIDEO',
  'video/3gpp': 'VIDEO',
  'audio/mpeg': 'AUDIO',
  'audio/ogg': 'AUDIO',
  'audio/wav': 'AUDIO',
  'audio/aac': 'AUDIO',
  'audio/amr': 'AUDIO',
  // What browsers actually record voice notes as: Chrome and Firefox produce WebM/Opus (the recorder reports
  // "audio/webm;codecs=opus"), Safari produces MP4/AAC. Safe to serve: audio types are never rendered as markup.
  'audio/webm': 'AUDIO',
  'audio/mp4': 'AUDIO',
  'audio/x-m4a': 'AUDIO',
  'audio/m4a': 'AUDIO',
  'application/pdf': 'DOCUMENT',
  'application/msword': 'DOCUMENT',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCUMENT',
  'application/vnd.ms-excel': 'DOCUMENT',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'DOCUMENT',
  'text/plain': 'DOCUMENT',
};

/**
 * "audio/webm;codecs=opus" -> "audio/webm". The allowlist is keyed by bare type, and a parameter such as
 * ;codecs=opus (which MediaRecorder always adds) made every recorded voice note fail with
 * "Unsupported file type".
 */
export function normalizeMimeType(mimetype: string | undefined | null): string {
  return (mimetype ?? '').split(';')[0]!.trim().toLowerCase();
}

@Injectable()
export class MediaService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  /**
   * `enforceUniqueName` is only for deliberate File Library uploads. Chat attachments, voice notes,
   * call recordings and product/profile images share this endpoint and legitimately reuse names
   * (WhatsApp exports, "voice-note.webm"), so they must not be rejected as library duplicates.
   */
  async upload(tenantId: string, uploadedById: string, file: Express.Multer.File, enforceUniqueName = false) {
    const mimeType = normalizeMimeType(file.mimetype);
    const mediaType = MIME_TO_MEDIA_TYPE[mimeType];
    if (!mediaType) {
      throw new BadRequestException(`Unsupported file type: ${mimeType || 'unknown'}`);
    }
    // Store and serve the bare type; the parameter adds nothing and would not match the allowlist later.
    file.mimetype = mimeType;

    if (enforceUniqueName) {
      const existing = await this.prisma.mediaAsset.findFirst({
        where: { tenantId, originalName: file.originalname },
      });
      if (existing) {
        throw new BadRequestException(`A file named "${file.originalname}" already exists in your library`);
      }
    }

    const { fileKey, fileUrl } = await this.storageService.upload(file, tenantId);

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

  /**
   * Media sent or received in conversations, one row per file (the most recent message that carries it).
   * Deduplication and pagination both happen in the database, so page N always holds `limit` distinct files
   * and `meta.total` counts distinct files (the old version fetched 3x the page, deduplicated in memory, and
   * counted duplicates, so pages came back short and totals were wrong).
   */
  async findMessageMedia(tenantId: string, page = 1, limit = 50, filters: MediaLibraryFilters = {}) {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 200) : 50;
    const f = normalizeMediaFilters(filters);
    const where = buildMediaWhere(tenantId, f);
    const skip = getPaginationSkip(safePage, safeLimit);

    const distinctRows = Prisma.sql`
      SELECT DISTINCT ON (m.media_url)
        m.id, m.type::text AS type, m.direction::text AS direction, m.media_url, m.media_type, m.media_caption, m.media_size,
        m.created_at, m.sender_id, m.conversation_id,
        c.id AS contact_id, c.name AS contact_name, c.phone AS contact_phone,
        u.name AS sender_name, u.is_ai_agent AS sender_is_ai,
        ch.id AS channel_id, ch.name AS channel_name, ch.type::text AS channel_type
      ${MEDIA_JOINS}
      WHERE ${where}
      ORDER BY m.media_url, m.created_at DESC, m.id DESC`;

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<MediaRow[]>`SELECT * FROM (${distinctRows}) d ORDER BY d.created_at DESC, d.id DESC LIMIT ${safeLimit} OFFSET ${skip}`,
      this.prisma.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM (${distinctRows}) d`,
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      type: r.type,
      direction: r.direction,
      mediaUrl: r.media_url,
      mediaType: r.media_type,
      mediaCaption: r.media_caption,
      mediaSize: r.media_size,
      createdAt: r.created_at,
      senderId: r.sender_id,
      // Only a human sender is named. The AI's synthetic user is reported as such, never as an agent.
      sender: r.sender_id ? { id: r.sender_id, name: r.sender_name, isAiAgent: !!r.sender_is_ai } : null,
      contact: { id: r.contact_id, name: r.contact_name, phone: r.contact_phone },
      conversation: { id: r.conversation_id },
      channel: r.channel_id ? { id: r.channel_id, name: r.channel_name, type: r.channel_type } : null,
    }));
    return { data, meta: buildPaginationMeta(Number(totals[0]?.total ?? 0), safePage, safeLimit) };
  }

  /** Human team members who have sent media in this workspace, for the "agent" filter. */
  async listMediaAgents(tenantId: string) {
    return this.prisma.$queryRaw<Array<{ id: string; name: string; count: bigint }>>`
      SELECT u.id, u.name, COUNT(DISTINCT m.media_url) AS count
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.tenant_id = ${tenantId} AND m.direction = 'OUTBOUND'::"MessageDirection" AND m.media_url IS NOT NULL
        AND m.type::text IN ('IMAGE','VIDEO','AUDIO','DOCUMENT') AND u.is_ai_agent = false
      GROUP BY u.id, u.name
      ORDER BY count DESC, u.name ASC`.then((rows) => rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })));
  }
}

interface MediaRow {
  id: string; type: string; direction: string; media_url: string; media_type: string | null; media_caption: string | null;
  media_size: number | null; created_at: Date; sender_id: string | null; conversation_id: string;
  contact_id: string | null; contact_name: string | null; contact_phone: string | null;
  sender_name: string | null; sender_is_ai: boolean | null;
  channel_id: string | null; channel_name: string | null; channel_type: string | null;
}
