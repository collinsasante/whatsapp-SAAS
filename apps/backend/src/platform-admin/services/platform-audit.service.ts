import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlatformAuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    adminId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.platformAuditLog.create({
      data: {
        adminId: params.adminId ?? null,
        action: params.action,
        resourceType: params.resourceType ?? null,
        resourceId: params.resourceId ?? null,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonObject) : Prisma.JsonNull,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  }

  async list(query: {
    action?: string;
    adminId?: string;
    resourceType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.action) where['action'] = { contains: query.action, mode: 'insensitive' };
    if (query.adminId) where['adminId'] = query.adminId;
    if (query.resourceType) where['resourceType'] = query.resourceType;

    const [logs, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { admin: { select: { id: true, email: true, name: true } } },
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);

    return { data: logs, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
