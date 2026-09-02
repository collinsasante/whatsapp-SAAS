import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiTaskType } from '@whatsapp-platform/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { PipelineTrace } from '../pipeline/pipeline.types';

/** agentId is optional here (unlike PipelineInput) -- non-pipeline callers
 * (summarize, KB-learn) have no AiAgent to attribute the call to. */
export interface TraceRecordInput {
  tenantId: string;
  agentId?: string;
  conversationId?: string;
  taskType: AiTaskType;
}

@Injectable()
export class AiExecutionsService {
  constructor(private prisma: PrismaService) {}

  record(input: TraceRecordInput, trace: PipelineTrace) {
    return this.prisma.aiExecution.create({
      data: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        promptVersionId: trace.promptVersionId,
        taskType: input.taskType,
        provider: trace.provider ?? 'unknown',
        modelKey: trace.modelKey ?? 'unknown',
        status: trace.status,
        latencyMs: trace.latencyMs,
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        estCostUsd: trace.estCostUsd,
        confidence: trace.confidence,
        safetyFlags: trace.safetyFlags as Prisma.InputJsonValue,
        errorCode: trace.errorCode,
        errorMessage: trace.errorMessage,
        stageTimings: trace.stageTimings as Prisma.InputJsonValue,
      },
    });
  }

  /** Called post-hoc once the caller has created its AiInteractionLog row (SUGGESTED/AUTO_SENT). */
  linkInteractionLog(executionId: string, interactionLogId: string) {
    return this.prisma.aiExecution.update({ where: { id: executionId }, data: { interactionLogId } });
  }

  async list(tenantId: string, opts: { conversationId?: string; status?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(opts.limit ?? 20, 100);
    const rows = await this.prisma.aiExecution.findMany({
      where: {
        tenantId,
        ...(opts.conversationId && { conversationId: opts.conversationId }),
        ...(opts.status && { status: opts.status }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async findOne(tenantId: string, id: string) {
    const execution = await this.prisma.aiExecution.findFirst({ where: { id, tenantId } });
    if (!execution) throw new NotFoundException('AI execution not found');
    return execution;
  }
}
