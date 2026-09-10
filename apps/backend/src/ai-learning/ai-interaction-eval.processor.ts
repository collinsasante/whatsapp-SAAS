import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueName, AiInteractionEvalJob } from '@whatsapp-platform/shared-types';
import { EvalQualityStatus, FailureSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InternalTasksService } from '../internal-tasks/internal-tasks.service';
import { InteractionContextResolver } from './interaction-context.resolver';
import { AiInteractionEvaluatorService } from './ai-interaction-evaluator.service';

const CRITICAL_TASK_SEVERITIES: FailureSeverity[] = ['CRITICAL', 'HIGH'];

/**
 * Consumes QueueName.AI_INTERACTION_EVAL. Runs in-process inside apps/backend
 * (not apps/worker) -- same deliberate deviation as EvaluationProcessor,
 * documented on that class: this needs NestJS DI (PrismaService,
 * InternalTasksService), which a bare bullmq.Worker in apps/worker doesn't have.
 *
 * Idempotent: AiInteractionEvaluation.aiExecutionId is unique, so a
 * duplicate-delivered job upserts the same row rather than creating a
 * second evaluation -- spec section 48.
 */
@Processor(QueueName.AI_INTERACTION_EVAL)
export class AiInteractionEvalProcessor extends WorkerHost {
  private readonly logger = new Logger(AiInteractionEvalProcessor.name);

  constructor(
    private prisma: PrismaService,
    private resolver: InteractionContextResolver,
    private evaluator: AiInteractionEvaluatorService,
    private internalTasks: InternalTasksService,
  ) {
    super();
  }

  async process(job: Job<AiInteractionEvalJob>): Promise<void> {
    const { aiExecutionId, tenantId } = job.data;

    const ctx = await this.resolver.resolve(tenantId, aiExecutionId);
    if (!ctx) {
      // Most likely messages.service.ts hasn't linked the AiInteractionLog to
      // this execution yet (a real, expected race, not an error) -- let
      // BullMQ's configured attempts/backoff retry this job rather than
      // failing it permanently on the first look.
      throw new Error(`AI interaction context not yet resolvable for execution ${aiExecutionId}`);
    }

    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const result = await this.evaluator.evaluate(ctx);

    if (!result) {
      if (!isLastAttempt) throw new Error(`Evaluator produced no result for execution ${aiExecutionId} -- will retry`);
      await this.prisma.aiInteractionEvaluation.upsert({
        where: { aiExecutionId },
        create: {
          tenantId, aiExecutionId, conversationId: ctx.conversationId, contactId: ctx.contactId,
          status: EvalQualityStatus.FAILED, evaluationError: 'Evaluator failed to produce a valid result after retries', retryCount: job.attemptsMade,
        },
        update: { status: EvalQualityStatus.FAILED, evaluationError: 'Evaluator failed to produce a valid result after retries', retryCount: job.attemptsMade },
      });
      return;
    }

    const status = result.needsHumanReview ? EvalQualityStatus.NEEDS_REVIEW : EvalQualityStatus.EVALUATED;

    const evaluation = await this.prisma.aiInteractionEvaluation.upsert({
      where: { aiExecutionId },
      create: {
        tenantId,
        aiExecutionId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        status,
        overallScore: result.overallScore,
        dimensions: result.dimensions as Prisma.InputJsonValue,
        failureCategories: result.failureCategories,
        severity: result.severity,
        evaluatorReasoning: result.reasoning,
        evaluatorConfidence: result.confidence,
        needsHumanReview: result.needsHumanReview,
        falseActionClaim: result.falseActionClaim,
        falseSuccessClaim: result.falseSuccessClaim,
        unnecessaryHandoff: result.unnecessaryHandoff,
        customerCorrectionDetected: result.customerCorrectionDetected,
        evaluatedAt: new Date(),
      },
      update: {
        status,
        overallScore: result.overallScore,
        dimensions: result.dimensions as Prisma.InputJsonValue,
        failureCategories: result.failureCategories,
        severity: result.severity,
        evaluatorReasoning: result.reasoning,
        evaluatorConfidence: result.confidence,
        needsHumanReview: result.needsHumanReview,
        falseActionClaim: result.falseActionClaim,
        falseSuccessClaim: result.falseSuccessClaim,
        unnecessaryHandoff: result.unnecessaryHandoff,
        customerCorrectionDetected: result.customerCorrectionDetected,
        evaluatedAt: new Date(),
        evaluationError: null,
      },
    });

    await this.prisma.aiLearningAuditLog.create({
      data: { tenantId, action: 'evaluation.completed', targetType: 'evaluation', targetId: evaluation.id, newState: { status, overallScore: result.overallScore, severity: result.severity } as Prisma.InputJsonValue },
    }).catch((err) => this.logger.warn(`Failed to write AI learning audit log: ${String(err)}`));

    // Critical failures automatically enter review -- spec section 15/66. Give
    // staff a REAL, existing task-inbox entry rather than only a dashboard
    // row nobody happens to check; skip if a task already exists for this
    // interaction (re-evaluation of the same execution should not spam tasks).
    if (result.severity && CRITICAL_TASK_SEVERITIES.includes(result.severity)) {
      const alreadyTasked = await this.prisma.internalTask.findFirst({
        where: { tenantId, conversationId: ctx.conversationId, department: 'ai_review', title: { contains: evaluation.id } },
        select: { id: true },
      });
      if (!alreadyTasked) {
        await this.internalTasks.create(tenantId, {
          department: 'ai_review',
          title: `AI response needs review (${result.severity}) -- evaluation ${evaluation.id}`,
          description: result.reasoning || result.failureCategories.join(', '),
          priority: result.severity === 'CRITICAL' ? 'URGENT' : 'HIGH',
          conversationId: ctx.conversationId,
          contactId: ctx.contactId ?? undefined,
        }).catch((err) => this.logger.warn(`Failed to create AI review task for evaluation ${evaluation.id}: ${String(err)}`));
      }
    }
  }
}
