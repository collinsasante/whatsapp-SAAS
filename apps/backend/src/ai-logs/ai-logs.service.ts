import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AiLogStatus = 'SUGGESTED' | 'APPROVED' | 'EDITED' | 'REJECTED' | 'AUTO_SENT';

export interface CreateAiLogDto {
  tenantId: string;
  conversationId: string;
  contactId?: string;
  customerMessage: string;
  aiResponse: string;
  status: AiLogStatus;
  confidenceScore?: number | null;
  responseTimeMs?: number;
}

@Injectable()
export class AiLogsService {
  constructor(private prisma: PrismaService) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get db(): any { return this.prisma as any; }

  async create(dto: CreateAiLogDto) {
    return this.db.aiInteractionLog.create({ data: dto });
  }

  async findByConversation(tenantId: string, conversationId: string) {
    return this.db.aiInteractionLog.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async updateStatus(
    tenantId: string,
    logId: string,
    status: AiLogStatus,
    agentId?: string,
    finalSentMessage?: string,
  ) {
    return this.db.aiInteractionLog.updateMany({
      where: { id: logId, tenantId },
      data: {
        status,
        agentId: agentId ?? undefined,
        editedByAgent: status === 'EDITED',
        finalSentMessage: finalSentMessage ?? undefined,
      },
    });
  }

  async submitFeedback(
    tenantId: string,
    logId: string,
    rating: number,
    label?: string,
    note?: string,
  ) {
    return this.db.aiInteractionLog.updateMany({
      where: { id: logId, tenantId },
      data: {
        feedbackRating: rating,
        feedbackLabel: label ?? undefined,
        feedbackNote: note ?? undefined,
      },
    });
  }

  async getAnalytics(tenantId: string, from: Date, to: Date) {
    type LogRow = {
      status: string;
      editedByAgent: boolean;
      confidenceScore: number | null;
      responseTimeMs: number | null;
      feedbackRating: number | null;
      createdAt: Date;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawLogs: any = await this.db.aiInteractionLog.findMany({
      where: { tenantId, createdAt: { gte: from, lte: to } },
      select: { status: true, editedByAgent: true, confidenceScore: true, responseTimeMs: true, feedbackRating: true, createdAt: true },
    });
    const logs = rawLogs as LogRow[];

    const total = logs.length;
    const approved  = logs.filter((l: LogRow) => l.status === 'APPROVED').length;
    const edited    = logs.filter((l: LogRow) => l.status === 'EDITED').length;
    const rejected  = logs.filter((l: LogRow) => l.status === 'REJECTED').length;
    const autoSent  = logs.filter((l: LogRow) => l.status === 'AUTO_SENT').length;
    const suggested = logs.filter((l: LogRow) => l.status === 'SUGGESTED').length;

    const sent = approved + edited + autoSent;
    const rated = logs.filter((l: LogRow) => l.feedbackRating !== null);
    const avgRating = rated.length
      ? rated.reduce((s: number, l: LogRow) => s + (l.feedbackRating ?? 0), 0) / rated.length
      : null;

    const timings = logs.filter((l: LogRow) => l.responseTimeMs !== null);
    const avgResponseMs = timings.length
      ? timings.reduce((s: number, l: LogRow) => s + (l.responseTimeMs ?? 0), 0) / timings.length
      : null;

    const confLogs = logs.filter((l: LogRow) => l.confidenceScore !== null);
    const avgConfidence = confLogs.length
      ? confLogs.reduce((s: number, l: LogRow) => s + (l.confidenceScore ?? 0), 0) / confLogs.length
      : null;

    // Daily usage breakdown
    const byDay: Record<string, number> = {};
    for (const l of logs) {
      const day = (l.createdAt as Date).toISOString().split('T')[0]!;
      byDay[day] = (byDay[day] ?? 0) + 1;
    }

    return {
      total,
      sent,
      approved,
      edited,
      rejected,
      autoSent,
      suggested,
      approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      editRate:     total > 0 ? Math.round((edited / total) * 100) : 0,
      rejectionRate: total > 0 ? Math.round((rejected / total) * 100) : 0,
      avgRating: avgRating !== null ? Math.round(avgRating * 10) / 10 : null,
      avgResponseMs: avgResponseMs !== null ? Math.round(avgResponseMs) : null,
      avgConfidence: avgConfidence !== null ? Math.round(avgConfidence) : null,
      dailyUsage: Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
    };
  }
}
