import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 0 = identical, 1 = completely rewritten. Ground-truth signal for how much
 *  an agent had to fix a suggestion before it was fit to send. */
function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return Math.round((dp[a.length][b.length] / maxLen) * 1000) / 1000;
}

export type AiLogStatus = 'SUGGESTED' | 'APPROVED' | 'EDITED' | 'REJECTED' | 'AUTO_SENT' | 'ESCALATED';

export interface CreateAiLogDto {
  tenantId: string;
  conversationId: string;
  contactId?: string;
  customerMessage: string;
  aiResponse: string;
  status: AiLogStatus;
  confidenceScore?: number | null;
  responseTimeMs?: number;
  sources?: string[];
  action?: string | null;
  verificationPassed?: boolean | null;
  verificationFailReason?: string | null;
  unverifiedDetail?: boolean;
  escalationReason?: string | null;
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
    let editDistanceRatio: number | undefined;
    if (status === 'EDITED' && finalSentMessage) {
      const original = await this.db.aiInteractionLog.findFirst({
        where: { id: logId, tenantId }, select: { aiResponse: true },
      });
      if (original?.aiResponse) editDistanceRatio = levenshteinRatio(original.aiResponse, finalSentMessage);
    }

    return this.db.aiInteractionLog.updateMany({
      where: { id: logId, tenantId },
      data: {
        status,
        agentId: agentId ?? undefined,
        editedByAgent: status === 'EDITED',
        finalSentMessage: finalSentMessage ?? undefined,
        editDistanceRatio: editDistanceRatio ?? undefined,
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
