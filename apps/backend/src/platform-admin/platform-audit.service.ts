import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformAuditEntry {
  adminId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: PlatformAuditEntry): Promise<void> {
    await this.prisma.platformAuditLog.create({
      data: {
        adminId: entry.adminId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata as never,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }
}
