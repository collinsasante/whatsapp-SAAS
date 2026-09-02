import { Injectable, NotFoundException } from '@nestjs/common';
import { ExceptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class ReconciliationService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  findAll(tenantId: string, status?: ExceptionStatus) {
    return this.prisma.reconciliationException.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { id: true, customerPhone: true, totalMajorUnits: true, currency: true } } },
    });
  }

  async resolve(tenantId: string, id: string, userId: string, resolutionNote?: string) {
    const exception = await this.prisma.reconciliationException.findFirst({ where: { id, tenantId } });
    if (!exception) throw new NotFoundException('Reconciliation exception not found');

    const updated = await this.prisma.reconciliationException.update({
      where: { id },
      data: { status: ExceptionStatus.RESOLVED, resolvedAt: new Date(), resolvedById: userId, resolutionNote },
    });

    await this.auditService.log({
      tenantId,
      userId,
      action: 'UPDATE',
      resource: 'ReconciliationException',
      resourceId: id,
      metadata: { resolutionNote, orderId: exception.orderId },
    });

    return updated;
  }

  /** Called by the reconciliation worker (and by manual re-run) when a mismatch is found. */
  async createException(tenantId: string, orderId: string, type: string, details: { expectedAmountMajorUnits?: number; actualAmountMajorUnits?: number; [key: string]: unknown }) {
    // Avoid duplicate OPEN exceptions of the same type for the same order across repeated worker runs.
    const existing = await this.prisma.reconciliationException.findFirst({
      where: { tenantId, orderId, type, status: ExceptionStatus.OPEN },
    });
    if (existing) return existing;

    return this.prisma.reconciliationException.create({
      data: {
        tenantId,
        orderId,
        type,
        expectedAmountMajorUnits: details.expectedAmountMajorUnits,
        actualAmountMajorUnits: details.actualAmountMajorUnits,
        details: details as never,
      },
    });
  }
}
