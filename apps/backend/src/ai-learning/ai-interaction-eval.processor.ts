import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueName, AiInteractionEvalJob } from '@whatsapp-platform/shared-types';
import { EvalQualityStatus, FailureSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InternalTasksService } from '../internal-tasks/internal-tasks.service';
import { InteractionContextResolver } from './interaction-context.resolver';
import { AiInteractionEvaluatorService, TransientJudgeError } from './ai-interaction-evaluator.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AI_LEARNING_FLAG_KEY } from './ai-learning-trigger.service';

const CRITICAL_TASK_SEVERITIES: FailureSeverity[] = ['CRITICAL', 'HIGH'];

/** Only these rows may still be (re)written by an evaluation run. Every other status is final: a completed evaluation, or a human decision. */
const WRITABLE_STATUSES: EvalQualityStatus[] = [EvalQualityStatus.FAILED, EvalQualityStatus.PENDING];

/** What the review-task step needs to know about a stored evaluation. */
const REVIEW_FIELDS = { id: true, status: true, severity: true, failureCategories: true, evaluatorReasoning: true, conversationId: true, contactId: true } as const;
interface StoredEvaluation {
  id: string;
  status: EvalQualityStatus;
  severity: FailureSeverity | null;
  failureCategories: string[];
  evaluatorReasoning: string | null;
  conversationId: string;
  contactId: string | null;
}

/** A write that keeps meeting a changing competitor is given up after this many rounds (the queue retries the job). */
const MAX_STORE_ROUNDS = 3;
/** The review-task transaction waits for the row lock, then does two small writes; generous so a slow notification does not abort it. */
const REVIEW_TASK_TX = { maxWait: 10_000, timeout: 20_000 } as const;

const isUniqueViolation = (err: unknown): boolean => !!err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002';

/**
 * Consumes QueueName.AI_INTERACTION_EVAL. Runs in-process inside apps/backend
 * (not apps/worker) -- same deliberate deviation as EvaluationProcessor,
 * documented on that class: this needs NestJS DI (PrismaService,
 * InternalTasksService), which a bare bullmq.Worker in apps/worker doesn't have.
 *
 * Idempotent: AiInteractionEvaluation.aiExecutionId is unique, so there is at most one evaluation per execution. A
 * duplicate-delivered job finds the stored evaluation BEFORE any provider call and never overwrites a completed or reviewed
 * one (writes are conditional, see storeUnlessFinal) -- spec section 48. The review task for a HIGH/CRITICAL evaluation is
 * created at most once, serialized on the evaluation row (see ensureReviewTask).
 */
@Processor(QueueName.AI_INTERACTION_EVAL)
export class AiInteractionEvalProcessor extends WorkerHost {
  private readonly logger = new Logger(AiInteractionEvalProcessor.name);

  constructor(
    private prisma: PrismaService,
    private resolver: InteractionContextResolver,
    private evaluator: AiInteractionEvaluatorService,
    private internalTasks: InternalTasksService,
    private featureFlags: FeatureFlagsService,
  ) {
    super();
  }

  async process(job: Job<AiInteractionEvalJob>): Promise<void> {
    const { aiExecutionId, tenantId } = job.data ?? ({} as Partial<AiInteractionEvalJob>);
    // A malformed job can never become valid, so it is dropped (no retry, no paid call) rather than thrown.
    if (typeof aiExecutionId !== 'string' || !aiExecutionId || typeof tenantId !== 'string' || !tenantId) {
      this.logger.warn('Dropping an AI interaction evaluation job with a missing aiExecutionId or tenantId');
      return;
    }

    // The flag is the kill switch: checked again here because the job may have been queued before it was turned off.
    if (!(await this.featureFlags.isEnabledCached(AI_LEARNING_FLAG_KEY, tenantId))) {
      this.logger.log(`AI learning is disabled for this tenant; skipping evaluation of execution ${aiExecutionId}`);
      return;
    }

    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    // Before any paid call: an evaluation that already exists (including one a human has since approved or rejected) is final.
    // Only a missing, PENDING or FAILED row is evaluated (again). A retry or duplicate delivery that lands here is also the
    // recovery path for a review task that the first run did not manage to create -- with no provider call.
    const existing = await this.prisma.aiInteractionEvaluation.findFirst({ where: { aiExecutionId, tenantId }, select: REVIEW_FIELDS });
    if (existing && !WRITABLE_STATUSES.includes(existing.status)) {
      this.logger.log(`Execution ${aiExecutionId} is already evaluated (${existing.status}); skipping the provider call`);
      await this.reviewTaskStep(tenantId, existing, isLastAttempt);
      return;
    }

    const ctx = await this.resolver.resolve(tenantId, aiExecutionId);
    if (!ctx) {
      // Most likely messages.service.ts hasn't linked the AiInteractionLog to
      // this execution yet (a real, expected race, not an error) -- let
      // BullMQ's configured attempts/backoff retry this job rather than
      // failing it permanently on the first look.
      throw new Error(`AI interaction context not yet resolvable for execution ${aiExecutionId}`);
    }

    const recordFailure = async (message: string): Promise<void> => {
      const stored = await this.storeUnlessFinal(
        tenantId, aiExecutionId,
        { tenantId, aiExecutionId, conversationId: ctx.conversationId, contactId: ctx.contactId, status: EvalQualityStatus.FAILED, evaluationError: message, retryCount: job.attemptsMade },
        { status: EvalQualityStatus.FAILED, evaluationError: message, retryCount: job.attemptsMade },
        'failure',
      );
      if (!stored) await this.settleCompleted(tenantId, aiExecutionId, isLastAttempt);
    };

    let result: Awaited<ReturnType<AiInteractionEvaluatorService['evaluate']>>;
    try {
      result = await this.evaluator.evaluate(ctx);
    } catch (err) {
      if (!(err instanceof TransientJudgeError)) throw err;
      // Retryable: let the queue retry with its backoff; only the last attempt records the failure.
      if (!isLastAttempt) throw err;
      await recordFailure('Evaluator failed to produce a valid result after retries');
      return;
    }

    if (!result) {
      // A permanent failure (rejected request, no content, unusable output): retrying would pay again for the same outcome.
      await recordFailure('Evaluator could not produce a valid result (permanent failure, not retried)');
      return;
    }

    const status = result.needsHumanReview ? EvalQualityStatus.NEEDS_REVIEW : EvalQualityStatus.EVALUATED;
    const scored = {
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
    };
    const stored = await this.storeUnlessFinal(
      tenantId, aiExecutionId,
      { tenantId, aiExecutionId, conversationId: ctx.conversationId, contactId: ctx.contactId, ...scored },
      { ...scored, evaluationError: null },
      'result',
    );
    if (!stored) {
      // A concurrent run completed (or a reviewer settled) this evaluation while this one was calling the provider. Its result stands.
      await this.settleCompleted(tenantId, aiExecutionId, isLastAttempt);
      return;
    }

    await this.prisma.aiLearningAuditLog.create({
      data: { tenantId, action: 'evaluation.completed', targetType: 'evaluation', targetId: stored.id, newState: { status, overallScore: result.overallScore, severity: result.severity } as Prisma.InputJsonValue },
    }).catch((err) => this.logger.warn(`Failed to write AI learning audit log: ${String(err)}`));

    await this.reviewTaskStep(tenantId, {
      id: stored.id, status, severity: result.severity, failureCategories: result.failureCategories,
      evaluatorReasoning: result.reasoning, conversationId: ctx.conversationId, contactId: ctx.contactId,
    }, isLastAttempt);
  }

  /**
   * Writes an evaluation row WITHOUT ever overwriting a final one. Returns the stored row's id, or null if the row was final
   * (completed, approved or rejected) or could not be seen in this tenant, and was left untouched.
   *
   * Guarantee, per statement (PostgreSQL, READ COMMITTED): `updateMany` is one `UPDATE ... WHERE ai_execution_id AND tenant_id AND
   * status IN (FAILED, PENDING)`. If a concurrent transaction changes the row first, the database re-checks the WHERE clause
   * against the new row version and the update matches nothing. `create` is guarded by the unique index on ai_execution_id. Prisma's
   * `upsert` cannot express the status condition, so it is not used.
   *
   * A unique violation only says that SOME row holds this execution id, so it is never taken as proof that a final evaluation
   * won: the row is re-read within this tenant first. A FAILED/PENDING competitor (for example a failure recorded by another run in
   * the gap between the two statements) means the guarded update is applied again, so a paid result is not lost. A final
   * competitor is a lost race. A conflict with a row that is not visible in this tenant is never read or touched and is logged as
   * an anomaly.
   */
  private async storeUnlessFinal(
    tenantId: string,
    aiExecutionId: string,
    createData: Prisma.AiInteractionEvaluationUncheckedCreateInput,
    updateData: Prisma.AiInteractionEvaluationUncheckedUpdateManyInput,
    purpose: 'result' | 'failure',
  ): Promise<{ id: string } | null> {
    for (let round = 0; round < MAX_STORE_ROUNDS; round++) {
      const updated = await this.prisma.aiInteractionEvaluation.updateMany({
        where: { aiExecutionId, tenantId, status: { in: WRITABLE_STATUSES } },
        data: updateData,
      });
      if (updated.count > 0) {
        return this.prisma.aiInteractionEvaluation.findFirst({ where: { aiExecutionId, tenantId }, select: { id: true } });
      }
      try {
        return await this.prisma.aiInteractionEvaluation.create({ data: createData, select: { id: true } });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const competing = await this.prisma.aiInteractionEvaluation.findFirst({ where: { aiExecutionId, tenantId }, select: { id: true, status: true } });
        if (!competing) {
          this.logWriteLost('error', { tenantId, aiExecutionId, purpose, reason: 'unique_conflict_with_unreadable_row' });
          return null;
        }
        if (!WRITABLE_STATUSES.includes(competing.status)) {
          this.logWriteLost('warn', { tenantId, aiExecutionId, purpose, reason: 'final_evaluation_won', competingEvaluationId: competing.id, competingStatus: competing.status });
          return null;
        }
        // FAILED or PENDING: not a final result. Go round again and apply the guarded update to it.
      }
    }
    throw new Error(`The evaluation for execution ${aiExecutionId} kept changing under concurrent writers; not stored`);
  }

  /** Ids and statuses only. Never the prompt, the model output, the reasoning text or any credential. */
  private logWriteLost(level: 'warn' | 'error', fields: { tenantId: string; aiExecutionId: string; purpose: 'result' | 'failure'; reason: string; competingEvaluationId?: string; competingStatus?: string }): void {
    this.logger[level](JSON.stringify({ event: 'ai_learning.evaluation_write_lost', ...fields, discarded: fields.purpose === 'result' ? 'a completed evaluator result' : 'a failure record' }));
  }

  /** After losing a write race: make sure the winning (completed) evaluation has its review task. */
  private async settleCompleted(tenantId: string, aiExecutionId: string, isLastAttempt: boolean): Promise<void> {
    const winner = await this.prisma.aiInteractionEvaluation.findFirst({ where: { aiExecutionId, tenantId }, select: REVIEW_FIELDS });
    if (winner && !WRITABLE_STATUSES.includes(winner.status)) await this.reviewTaskStep(tenantId, winner, isLastAttempt);
  }

  /**
   * Critical failures automatically enter review -- spec section 15/66. Gives staff a REAL, existing task-inbox entry rather than
   * only a dashboard row nobody happens to check. Idempotent: an existing task for this evaluation is never duplicated, so it is
   * safe to call from a retry or a duplicate delivery. Failures (the lookup as well as the create) are handled the same way:
   * logged on the last attempt, but rethrown before that so the queue retries -- and a retry costs no provider call, because the
   * stored evaluation short-circuits it straight back to this step.
   */
  private async reviewTaskStep(tenantId: string, evaluation: StoredEvaluation, isLastAttempt: boolean): Promise<void> {
    try {
      await this.ensureReviewTask(tenantId, evaluation);
    } catch (err) {
      if (!isLastAttempt) throw err;
      this.logger.warn(`Failed to ensure the AI review task for evaluation ${evaluation.id}: ${String(err)}`);
    }
  }

  /**
   * Creates the review task at most once, and never for an evaluation a human has already settled.
   *
   * The InternalTask table has no unique key to enforce "one task per evaluation", so uniqueness is enforced by serialization:
   * everything runs in a transaction that first locks the evaluation row (`SELECT ... FOR UPDATE`). Two workers on the same
   * evaluation therefore take turns: the second waits for the first to commit (its task is then visible to the lookup, which
   * runs after the lock is granted, under READ COMMITTED) and creates nothing. A reviewer's approval/rejection is an UPDATE of the
   * same row, so it conflicts with the lock: it either commits first (and the status read under the lock shows the decision, so
   * no task is created) or waits until the task exists. The task itself is inserted by InternalTasksService on its own
   * connection, but is committed before this transaction releases the lock.
   *
   * This guarantees uniqueness only among callers that go through this method; it is not a database constraint.
   */
  private async ensureReviewTask(tenantId: string, evaluation: StoredEvaluation): Promise<void> {
    if (!evaluation.severity || !CRITICAL_TASK_SEVERITIES.includes(evaluation.severity)) return;
    // Cheap pre-filter on the snapshot we already hold; the authoritative status check is the one made under the lock below.
    if (evaluation.status === EvalQualityStatus.APPROVED || evaluation.status === EvalQualityStatus.REJECTED) return;

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status FROM ai_interaction_evaluations
        WHERE id = ${evaluation.id} AND tenant_id = ${tenantId}
        FOR UPDATE`;
      if (locked.length === 0) return; // gone, or not this tenant's
      // A human has decided this one; a review task would be noise.
      if (locked[0].status === EvalQualityStatus.APPROVED || locked[0].status === EvalQualityStatus.REJECTED) return;

      const alreadyTasked = await tx.internalTask.findFirst({
        where: { tenantId, conversationId: evaluation.conversationId, department: 'ai_review', title: { contains: evaluation.id } },
        select: { id: true },
      });
      if (alreadyTasked) return;
      await this.internalTasks.create(tenantId, {
        department: 'ai_review',
        title: `AI response needs review (${evaluation.severity}) -- evaluation ${evaluation.id}`,
        description: evaluation.evaluatorReasoning || evaluation.failureCategories.join(', '),
        priority: evaluation.severity === 'CRITICAL' ? 'URGENT' : 'HIGH',
        conversationId: evaluation.conversationId,
        contactId: evaluation.contactId ?? undefined,
      });
    }, REVIEW_TASK_TX);
  }
}
