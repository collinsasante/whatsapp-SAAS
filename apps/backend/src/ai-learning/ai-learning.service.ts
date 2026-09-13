import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EvalQualityStatus, TrainingExampleStatus, FailureCategory, TakeoverClassification, CorrectionCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private prisma: PrismaService) {}

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

  async setTrainingExampleStatus(tenantId: string, id: string, status: TrainingExampleStatus, actorId: string) {
    const example = await this.prisma.aiTrainingExample.findFirst({ where: { id, tenantId } });
    if (!example) throw new NotFoundException('Training example not found');

    const updated = await this.prisma.aiTrainingExample.update({
      where: { id },
      data: {
        status,
        ...(status === TrainingExampleStatus.APPROVED && { approvedById: actorId, approvedAt: new Date() }),
      },
    });
    await this.audit(tenantId, actorId, `training_example.${status.toLowerCase()}`, 'training_example', id, { status: example.status }, { status });
    return updated;
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

  async listTrainingExamples(tenantId: string, status?: TrainingExampleStatus) {
    return this.prisma.aiTrainingExample.findMany({ where: { tenantId, ...(status && { status }) }, orderBy: { createdAt: 'desc' }, take: 100 });
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
