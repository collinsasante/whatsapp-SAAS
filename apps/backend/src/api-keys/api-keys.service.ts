import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  private hashKey(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  async create(tenantId: string, userId: string, name: string, expiresAt?: Date) {
    const raw = `wap_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = this.hashKey(raw);
    const keyPrefix = raw.slice(0, 12);

    const record = await this.prisma.apiKey.create({
      data: { tenantId, createdById: userId, name, keyHash, keyPrefix, expiresAt },
    });

    return { ...record, key: raw };
  }

  list(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async revoke(id: string, tenantId: string) {
    const existing = await this.prisma.apiKey.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('API key not found');
    return this.prisma.apiKey.update({ where: { id }, data: { isActive: false } });
  }

  async delete(id: string, tenantId: string) {
    const existing = await this.prisma.apiKey.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('API key not found');
    return this.prisma.apiKey.delete({ where: { id } });
  }

  getLogs(tenantId: string) {
    return this.prisma.publicApiLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { apiKey: { select: { id: true, name: true, keyPrefix: true } } },
    });
  }

  async validateKey(raw: string): Promise<{ tenantId: string; id: string } | null> {
    const keyHash = this.hashKey(raw);
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: { id: true, tenantId: true, isActive: true, expiresAt: true },
    });
    if (!record || !record.isActive) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    await this.prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return { tenantId: record.tenantId, id: record.id };
  }
}
