import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { EvalQualityStatus, TrainingExampleStatus, FailureCategory, TakeoverClassification, CorrectionCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DigitalSelfCorrectionsService, correctionKey } from '../digital-self/digital-self-corrections.service';
import { lockDigitalSelf, rebuildFromEvents } from '../digital-self/evidence.util';
import { loadRetentionSettings } from './learning-retention.service';

export interface ListInteractionsFilters {
  status?: EvalQualityStatus;
  severity?: string;
  failureCategory?: FailureCategory;
  conversationId?: string;
  needsHumanReview?: boolean;
  cursor?: string;
  limit?: number;
}

export interface SubmitFeedbackInput {
  reviewerId: string;
  rating: 'GOOD' | 'BAD';
  reason?: string;
  notes?: string;
  expectedAction?: string;
  expectedResponse?: string;
  takeoverClassification?: TakeoverClassification;
  correctionCategory?: CorrectionCategory;
}

@Injectable()
export class AiLearningService {
  constructor(
    private prisma: PrismaService,
    @Optional() private digitalSelfCorrections?: DigitalSelfCorrectionsService,
  ) {}

  // ─── Overview / analytics ────────────────────────────────────────────

  async overview(tenantId: string, sinceHours = 24 * 7) {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const where = { tenantId, createdAt: { gte: since } };

    const [total, byStatus, avgScore, needsReview, falseClaims, corrections] = await Promise.all([
      this.prisma.aiInteractionEvaluation.count({ where }),
      this.prisma.aiInteractionEvaluation.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.aiInteractionEvaluation.aggregate({ where: { ...where, overallScore: { not: null } }, _avg: { overallScore: true } }),
      this.prisma.aiInteractionEvaluation.count({ where: { ...where, needsHumanReview: true } }),
      this.prisma.aiInteractionEvaluation.count({ where: { ...where, OR: [{ falseActionClaim: true }, { falseSuccessClaim: true }] } }),
      this.prisma.aiCustomerCorrection.count({ where: { tenantId, createdAt: { gte: since } } }),
    ]);

    const failureCounts = await this.prisma.aiInteractionEvaluation.findMany({
      where: { ...where, failureCategories: { isEmpty: false } },
      select: { failureCategories: true },
    });
    const tally = new Map<string, number>();
    for (const row of failureCounts) for (const cat of row.failureCategories) tally.set(cat, (tally.get(cat) ?? 0) + 1);
    const topFailures = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([category, count]) => ({ category, count }));

    return {
      windowHours: sinceHours,
      totalInteractions: total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      averageQualityScore: avgScore._avg.overallScore,
      needsReviewCount: needsReview,
      falseClaimCount: falseClaims,
      customerCorrectionCount: corrections,
      topFailureCategories: topFailures,
    };
  }

  // ─── Interactions ────────────────────────────────────────────────────

  async listInteractions(tenantId: string, filters: ListInteractionsFilters) {
    const limit = Math.min(filters.limit ?? 20, 100);
    const rows = await this.prisma.aiInteractionEvaluation.findMany({
      where: {
        tenantId,
        ...(filters.status && { status: filters.status }),
        ...(filters.severity && { severity: filters.severity as never }),
        ...(filters.failureCategory && { failureCategories: { has: filters.failureCategory } }),
        ...(filters.conversationId && { conversationId: filters.conversationId }),
        ...(filters.needsHumanReview !== undefined && { needsHumanReview: filters.needsHumanReview }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor && { cursor: { id: filters.cursor }, skip: 1 }),
      include: { feedback: true, aiExecution: { select: { taskType: true, modelKey: true, latencyMs: true } } },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async getInteraction(tenantId: string, id: string) {
    const evaluation = await this.prisma.aiInteractionEvaluation.findFirst({
      where: { id, tenantId },
      include: {
        aiExecution: true,
        feedback: { include: { reviewer: { select: { id: true, name: true } } } },
        trainingExamples: true,
        corrections: true,
        conversation: { select: { id: true, contact: { select: { id: true, name: true, phone: true } } } },
      },
    });
    if (!evaluation) throw new NotFoundException('Evaluation not found');
    return evaluation;
  }

  // ─── Human feedback / review ─────────────────────────────────────────

  async submitFeedback(tenantId: string, evaluationId: string, input: SubmitFeedbackInput) {
    const evaluation = await this.prisma.aiInteractionEvaluation.findFirst({ where: { id: evaluationId, tenantId } });
    if (!evaluation) throw new NotFoundException('Evaluation not found');

    const feedback = await this.prisma.aiEvaluationFeedback.upsert({
      where: { evaluationId },
      create: {
        evaluationId, tenantId, reviewerId: input.reviewerId, rating: input.rating, reason: input.reason,
        notes: input.notes, expectedAction: input.expectedAction, expectedResponse: input.expectedResponse,
        takeoverClassification: input.takeoverClassification, correctionCategory: input.correctionCategory,
      },
      update: {
        reviewerId: input.reviewerId, rating: input.rating, reason: input.reason, notes: input.notes,
        expectedAction: input.expectedAction, expectedResponse: input.expectedResponse,
        takeoverClassification: input.takeoverClassification, correctionCategory: input.correctionCategory,
      },
    });

    const newStatus = input.rating === 'GOOD' ? EvalQualityStatus.APPROVED : EvalQualityStatus.REJECTED;
    await this.prisma.aiInteractionEvaluation.update({ where: { id: evaluationId }, data: { status: newStatus } });

    await this.audit(tenantId, input.reviewerId, 'evaluation.feedback_submitted', 'evaluation', evaluationId, { status: evaluation.status }, { status: newStatus, rating: input.rating });
    return feedback;
  }

  // ─── Customer corrections ────────────────────────────────────────────

  async recordCorrection(tenantId: string, evaluationId: string, input: { correctionMessageId: string; category: CorrectionCategory; reviewerId?: string; reviewerNotes?: string; expectedInterpretation?: string }) {
    const evaluation = await this.prisma.aiInteractionEvaluation.findFirst({ where: { id: evaluationId, tenantId } });
    if (!evaluation) throw new NotFoundException('Evaluation not found');

    const correction = await this.prisma.aiCustomerCorrection.create({
      data: { tenantId, evaluationId, correctionMessageId: input.correctionMessageId, category: input.category, reviewerId: input.reviewerId, reviewerNotes: input.reviewerNotes, expectedInterpretation: input.expectedInterpretation },
    });
    if (input.category === 'CUSTOMER_CORRECTION') {
      await this.prisma.aiInteractionEvaluation.update({ where: { id: evaluationId }, data: { customerCorrectionDetected: true, needsHumanReview: true } });
    }
    await this.audit(tenantId, input.reviewerId ?? null, 'correction.recorded', 'evaluation', evaluationId, null, { category: input.category });
    return correction;
  }

  // ─── Training examples ───────────────────────────────────────────────

  async createTrainingExample(tenantId: string, evaluationId: string, actorId: string) {
    const evaluation = await this.prisma.aiInteractionEvaluation.findFirst({
      where: { id: evaluationId, tenantId },
      include: { feedback: true, aiExecution: { select: { interactionLogId: true } } },
    });
    if (!evaluation) throw new NotFoundException('Evaluation not found');
    if (!evaluation.feedback) throw new BadRequestException('An evaluation needs human feedback (expected action/response) before it can become a training example');

    // One live example per evaluation: a second one for the same turn would be a duplicate precedent. A rejected or archived one does not block a fresh attempt.
    const existing = await this.prisma.aiTrainingExample.findFirst({
      where: { tenantId, sourceEvaluationId: evaluationId, status: { notIn: [TrainingExampleStatus.REJECTED, TrainingExampleStatus.ARCHIVED] } },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('A training example already exists for this evaluation');

    const log = evaluation.aiExecution.interactionLogId
      ? await this.prisma.aiInteractionLog.findUnique({ where: { id: evaluation.aiExecution.interactionLogId }, select: { customerMessage: true, aiResponse: true } })
      : null;

    const example = await this.prisma.aiTrainingExample.create({
      data: {
        tenantId,
        sourceEvaluationId: evaluationId,
        sourceConversationId: evaluation.conversationId,
        sourceMessageId: evaluation.messageId,
        customerInput: log?.customerMessage ?? '',
        actualResponse: log?.aiResponse ?? '',
        expectedAction: evaluation.feedback.expectedAction,
        expectedResponse: evaluation.feedback.expectedResponse,
        failureCategories: evaluation.failureCategories,
        reviewerNotes: evaluation.feedback.notes,
        status: TrainingExampleStatus.DRAFT,
      },
    });
    await this.audit(tenantId, actorId, 'training_example.created', 'training_example', example.id, null, { status: example.status });
    return example;
  }

  /**
   * Training example lifecycle (every state is explicit about what it does to AI replies and to the stored text):
   *   DRAFT / REVIEW   proposed or awaiting approval. Never influences replies. Text is held.
   *   APPROVED         the only state that influences replies (workspace guidance, or one agent's style for a style correction).
   *   REJECTED         decided against. Never influences replies. Text is held until deleted.
   *   ARCHIVED         retired but recoverable. Never influences replies. Text is held until deleted.
   * Leaving APPROVED (to any state) stops the influence immediately and clears the approval record. Only deleteTrainingExample removes the
   * text. Nothing here deletes automatically; automatic retention is a separate, disabled-by-default sweep.
   */
  async setTrainingExampleStatus(tenantId: string, id: string, status: TrainingExampleStatus, actorId: string) {
    const example = await this.prisma.aiTrainingExample.findFirst({ where: { id, tenantId } });
    if (!example) throw new NotFoundException('Training example not found');
    // Approval is what lets the AI use an example, so there must be something concrete to teach. An example with neither an expected
    // action nor an expected reply, or without the customer message it applies to, could only ever be noise in a prompt.
    if (status === TrainingExampleStatus.APPROVED && (!example.customerInput.trim() || !(example.expectedAction?.trim() || example.expectedResponse?.trim()))) {
      throw new BadRequestException('A training example needs the customer message and an expected action or reply before it can be approved');
    }
    return this.applyStatus(tenantId, example, status, actorId, `training_example.${status.toLowerCase()}`);
  }

  /** APPROVED to REVIEW: the example stops influencing replies at once and keeps its text for further review. */
  async withdrawTrainingExample(tenantId: string, id: string, actorId: string) {
    const example = await this.prisma.aiTrainingExample.findFirst({ where: { id, tenantId } });
    if (!example) throw new NotFoundException('Training example not found');
    if (example.status !== TrainingExampleStatus.APPROVED) throw new BadRequestException('Only an approved training example can be withdrawn');
    return this.applyStatus(tenantId, example, TrainingExampleStatus.REVIEW, actorId, 'training_example.withdrawn');
  }

  private async applyStatus(tenantId: string, example: { id: string; status: TrainingExampleStatus }, status: TrainingExampleStatus, actorId: string, auditAction: string) {
    const leavingApproved = example.status === TrainingExampleStatus.APPROVED && status !== TrainingExampleStatus.APPROVED;
    const updated = await this.prisma.aiTrainingExample.update({
      where: { id: example.id },
      data: {
        status,
        ...(status === TrainingExampleStatus.APPROVED && { approvedById: actorId, approvedAt: new Date() }),
        ...(leavingApproved && { approvedById: null, approvedAt: null }),
      },
    });
    await this.audit(tenantId, actorId, auditAction, 'training_example', example.id, { status: example.status }, { status });
    // A style-only correction also refines the Digital Self of the agent whose style the reply was written in. It never blocks or fails
    // the approval workflow, and anything that is not a style correction is left exactly as it was.
    await this.digitalSelfCorrections?.sync(tenantId, example.id, actorId).catch((err: unknown) => new Logger(AiLearningService.name).warn(`Digital Self correction sync failed: ${err instanceof Error ? err.name : 'unknown'}`));
    return updated;
  }

  /**
   * Permanently deletes ONE training example and everything that depends on it, in one transaction: the example row (and so its customer
   * text, reply text and reviewer notes), and, if it was applied as a style correction, that contribution to the agent's Digital Self
   * (the profile is rebuilt from the remaining evidence). The removal of the style contribution does not depend on the Digital Self
   * feature flag. The audit row holds the id, the previous status and yes/no facts only, never text. The interaction record and the
   * evaluation the example came from are NOT deleted here; they go with the conversation or the retention sweep.
   */
  async deleteTrainingExample(tenantId: string, id: string, actorId: string): Promise<{ deleted: true; wasApproved: boolean; promotedToRegressionCase: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const example = await tx.aiTrainingExample.findFirst({ where: { id, tenantId }, select: { id: true, status: true, regressionCaseCreated: true } });
      if (!example) throw new NotFoundException('Training example not found');

      const contribution = await tx.digitalSelfLearningEvent.findFirst({ where: { tenantId, messageId: correctionKey(id) }, select: { id: true, digitalSelfId: true } });
      if (contribution) {
        await lockDigitalSelf(tx, contribution.digitalSelfId);
        await tx.digitalSelfLearningEvent.deleteMany({ where: { id: contribution.id, tenantId } });
        await rebuildFromEvents(tx, tenantId, contribution.digitalSelfId);
      }
      await tx.aiTrainingExample.deleteMany({ where: { id, tenantId } });

      const wasApproved = example.status === TrainingExampleStatus.APPROVED;
      await tx.aiLearningAuditLog.create({
        data: {
          tenantId, actorId, action: 'training_example.deleted', targetType: 'training_example', targetId: id,
          previousState: { status: example.status, styleContributionRemoved: !!contribution, promotedToRegressionCase: example.regressionCaseCreated } as Prisma.InputJsonValue,
        },
      });
      return { deleted: true as const, wasApproved, promotedToRegressionCase: example.regressionCaseCreated };
    });
  }

  /** Marks that an engineer has manually promoted this example into the
   * existing commerce/evaluation scenario harness (a source-file edit + PR,
   * not something this API writes to disk itself -- see schema comment on
   * AiTrainingExample.regressionCaseCreated). */
  async markRegressionCaseCreated(tenantId: string, id: string, actorId: string) {
    const example = await this.prisma.aiTrainingExample.findFirst({ where: { id, tenantId } });
    if (!example) throw new NotFoundException('Training example not found');
    if (example.status !== TrainingExampleStatus.APPROVED) throw new BadRequestException('Only an APPROVED training example can be promoted to a regression case');

    const updated = await this.prisma.aiTrainingExample.update({ where: { id }, data: { regressionCaseCreated: true } });
    await this.audit(tenantId, actorId, 'training_example.regression_case_created', 'training_example', id, null, null);
    return updated;
  }

  /** Each example says what it currently does to AI replies, so an administrator never has to guess from the status name. */
  async listTrainingExamples(tenantId: string, status?: TrainingExampleStatus) {
    const [rows, settings] = await Promise.all([
      this.prisma.aiTrainingExample.findMany({ where: { tenantId, ...(status && { status }) }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.aiLearningSettings.findUnique({ where: { tenantId }, select: { approvedGuidanceEnabled: true } }),
    ]);
    const guidanceOn = (settings?.approvedGuidanceEnabled ?? true) && process.env['AI_CORRECTIONS_DISABLED'] !== 'true';
    return rows.map((r) => ({
      ...r,
      influence: r.status !== TrainingExampleStatus.APPROVED ? ('none' as const) : r.digitalSelfId ? ('style_correction' as const) : guidanceOn ? ('guidance' as const) : ('none' as const),
    }));
  }

  /** What learning-derived customer text this workspace currently holds, so retention is visible and nothing is held silently. */
  async privacyHoldings(tenantId: string) {
    const [logs, oldestLog, evaluationsWithText, evaluations, examples, reviewTasks, styleEvents] = await Promise.all([
      this.prisma.aiInteractionLog.count({ where: { tenantId, OR: [{ customerMessage: { not: '' } }, { aiResponse: { not: '' } }] } }),
      this.prisma.aiInteractionLog.aggregate({ where: { tenantId, OR: [{ customerMessage: { not: '' } }, { aiResponse: { not: '' } }] }, _min: { createdAt: true } }),
      this.prisma.aiInteractionEvaluation.count({ where: { tenantId, OR: [{ evaluatorReasoning: { not: null } }, { evaluationError: { not: null } }] } }),
      this.prisma.aiInteractionEvaluation.count({ where: { tenantId } }),
      this.prisma.aiTrainingExample.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.internalTask.count({ where: { tenantId, department: 'ai_review', description: { not: null } } }),
      this.prisma.digitalSelfLearningEvent.count({ where: { tenantId } }),
    ]);
    const retention = loadRetentionSettings();
    const byStatus = Object.fromEntries(examples.map((e) => [e.status, e._count._all])) as Partial<Record<TrainingExampleStatus, number>>;
    return {
      interactionRecordsWithText: logs,
      oldestInteractionRecordAt: oldestLog._min.createdAt,
      evaluations,
      evaluationsWithText,
      reviewTasksWithText: reviewTasks,
      trainingExamples: { total: examples.reduce((n, e) => n + e._count._all, 0), approved: byStatus.APPROVED ?? 0, byStatus },
      /** Numbers and fixed-vocabulary markers only; no message text. */
      styleEvidenceItems: styleEvents,
      automaticDeletion: { enabled: retention.enabled, freeTextDays: retention.freeTextDays, metricsMonths: retention.metricsMonths },
    };
  }

  // ─── Failures / corrections listings ─────────────────────────────────

  async listFailures(tenantId: string) {
    return this.prisma.aiInteractionEvaluation.findMany({
      where: { tenantId, needsHumanReview: true, status: { notIn: [EvalQualityStatus.APPROVED, EvalQualityStatus.REJECTED] } },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async listCorrections(tenantId: string) {
    return this.prisma.aiCustomerCorrection.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100, include: { evaluation: { select: { id: true, conversationId: true } } } });
  }

  // ─── Audit ────────────────────────────────────────────────────────────

  private async audit(tenantId: string, actorId: string | null, action: string, targetType: string, targetId: string, previousState: unknown, newState: unknown) {
    await this.prisma.aiLearningAuditLog.create({
      data: {
        tenantId, actorId: actorId ?? undefined, action, targetType, targetId,
        previousState: (previousState ?? undefined) as Prisma.InputJsonValue | undefined,
        newState: (newState ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    }).catch(() => null);
  }
}
