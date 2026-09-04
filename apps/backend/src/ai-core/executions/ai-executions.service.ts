import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiTaskType } from '@whatsapp-platform/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { PipelineTrace } from '../pipeline/pipeline.types';
import { AiCreditsService } from '../credits/ai-credits.service';
import { AiPricingService } from '../pricing/ai-pricing.service';

/** agentId is optional here (unlike PipelineInput) -- non-pipeline callers
 * (summarize, KB-learn) have no AiAgent to attribute the call to. */
export interface TraceRecordInput {
  tenantId: string;
  agentId?: string;
  conversationId?: string;
  taskType: AiTaskType;
}

/** Only these task types represent customer-facing/sales AI usage that
 * should consume credits -- SUMMARIZE/KB_LEARN/TEST are admin/background
 * tooling, deliberately left unmetered. */
const CREDIT_METERED_TASK_TYPES: AiTaskType[] = ['RESPONDER', 'LEAD_SCORE'];

@Injectable()
export class AiExecutionsService {
  private readonly logger = new Logger(AiExecutionsService.name);

  constructor(
    private prisma: PrismaService,
    private credits: AiCreditsService,
    private pricing: AiPricingService,
  ) {}

  /**
   * The single central point every real AI call converges on -- also where
   * Verz AI Credits get charged, right when real token usage is known. A
   * non-SUCCESS trace (PROVIDER_ERROR/BLOCKED/EMPTY) naturally has null
   * inputTokens/outputTokens (DeepSeekProvider only ever returns usage on a
   * fully successful response), so treating them as 0 below means failed
   * calls are never charged with no special-casing needed.
   */
  async record(input: TraceRecordInput, trace: PipelineTrace) {
    const execution = await this.prisma.aiExecution.create({
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

    if (CREDIT_METERED_TASK_TYPES.includes(input.taskType)) {
      try {
        const creditsOwed = await this.pricing.getCreditsForUsage(
          trace.provider ?? 'unknown',
          trace.modelKey ?? 'unknown',
          trace.inputTokens ?? 0,
          trace.outputTokens ?? 0,
        );
        await this.credits.settleForExecution(input.tenantId, execution.id, creditsOwed, `${input.taskType} AI usage`);
      } catch (err) {
        // Credit settlement must never be why a customer doesn't get a reply --
        // the AI call and its response already happened by this point.
        this.logger.error(`Failed to settle credits for AiExecution ${execution.id}`, err instanceof Error ? err.stack : String(err));
      }
    }

    return execution;
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
