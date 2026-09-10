import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordErrorInput {
  service: string;
  severity?: 'WARN' | 'ERROR' | 'CRITICAL';
  message: string;
  stack?: string;
  tenantId?: string;
  requestId?: string;
  resourceType?: string;
  resourceId?: string;
}

export interface ListErrorLogsParams {
  status?: string;
  severity?: string;
  tenantId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);

  constructor(private prisma: PrismaService) {}

  private fingerprint(input: RecordErrorInput): string {
    const raw = `${input.service}:${input.resourceType ?? ''}:${input.message.slice(0, 200)}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /** Never throws -- recording an error must not itself break the request path it's observing. */
  async record(input: RecordErrorInput): Promise<void> {
    try {
      const fingerprint = this.fingerprint(input);
      await this.prisma.errorLog.upsert({
        where: { fingerprint },
        create: {
          tenantId: input.tenantId,
          service: input.service,
          severity: input.severity ?? 'ERROR',
          message: input.message.slice(0, 4000),
          stack: input.stack?.slice(0, 8000),
          requestId: input.requestId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          fingerprint,
        },
        update: {
          occurrenceCount: { increment: 1 },
          lastSeenAt: new Date(),
          ...(input.requestId ? { requestId: input.requestId } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record error log: ${String(err)}`);
    }
  }

  async list(params: ListErrorLogsParams) {
    const { status, severity, tenantId, search, limit = 50, offset = 0 } = params;
    const where = {
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(search ? { message: { contains: search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.errorLog.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
        include: { tenant: { select: { id: true, name: true } } },
      }),
      this.prisma.errorLog.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async findOne(id: string) {
    return this.prisma.errorLog.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true } } },
    });
  }

  async updateStatus(id: string, status: 'OPEN' | 'RESOLVED' | 'IGNORED') {
    return this.prisma.errorLog.update({ where: { id }, data: { status } });
  }
}
