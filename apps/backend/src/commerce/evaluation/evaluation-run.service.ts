import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueName, AiEvalRunJob } from '@whatsapp-platform/shared-types';
import { EvaluationCaseStatus, EvaluationRunStatus, EvaluationVerdict } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMERCE_EVAL_SCENARIOS } from './scenarios/commerce-eval-scenarios';

@Injectable()
export class EvaluationRunService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue(QueueName.AI_EVAL_RUN) private evalQueue: Queue<AiEvalRunJob>,
  ) {}

  async createRun(tenantId: string, userId: string) {
    const run = await this.prisma.evaluationRun.create({
      data: { tenantId, triggeredByUserId: userId, status: EvaluationRunStatus.QUEUED, scenarioCount: COMMERCE_EVAL_SCENARIOS.length },
    });
    await this.evalQueue.add('run', { evaluationRunId: run.id, tenantId }, { attempts: 1, removeOnComplete: 20, removeOnFail: 20 });
    return run;
  }

  findAll(tenantId: string, page = 1, limit = 20) {
    return Promise.all([
      this.prisma.evaluationRun.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.evaluationRun.count({ where: { tenantId } }),
    ]).then(([data, total]) => ({ data, total, page, limit }));
  }

  async findOne(tenantId: string, id: string) {
    const run = await this.prisma.evaluationRun.findFirst({
      where: { id, tenantId },
      include: { cases: { orderBy: { createdAt: 'asc' }, select: { id: true, scenarioKey: true, criteria: true, status: true, failureReasons: true, createdAt: true } } },
    });
    if (!run) throw new NotFoundException('Evaluation run not found');
    return run;
  }

  async findCase(tenantId: string, runId: string, caseId: string) {
    const evalCase = await this.prisma.evaluationCase.findFirst({ where: { id: caseId, evaluationRunId: runId, tenantId } });
    if (!evalCase) throw new NotFoundException('Evaluation case not found');
    return evalCase;
  }

  // ─── Called by EvaluationProcessor as the run executes ──────────────

  markRunning(id: string) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { status: EvaluationRunStatus.RUNNING, startedAt: new Date() } });
  }

  async saveCaseResult(runId: string, tenantId: string, params: {
    scenarioKey: string; criteria: string[]; status: EvaluationCaseStatus;
    contactId?: string; conversationId?: string; orderId?: string;
    transcript: unknown; scores: unknown; failureReasons: string[];
  }) {
    return this.prisma.evaluationCase.create({
      data: {
        evaluationRunId: runId, tenantId, scenarioKey: params.scenarioKey, criteria: params.criteria, status: params.status,
        contactId: params.contactId, conversationId: params.conversationId, orderId: params.orderId,
        transcript: params.transcript as never, scores: params.scores as never, failureReasons: params.failureReasons,
      },
    });
  }

  async completeRun(id: string, params: { overallVerdict: EvaluationVerdict; criticalFailure: boolean; skippedCount: number; criteriaSummary: unknown }) {
    return this.prisma.evaluationRun.update({
      where: { id },
      data: {
        status: EvaluationRunStatus.COMPLETED,
        completedAt: new Date(),
        overallVerdict: params.overallVerdict,
        criticalFailure: params.criticalFailure,
        skippedCount: params.skippedCount,
        criteriaSummary: params.criteriaSummary as never,
      },
    });
  }

  failRun(id: string, errorMessage: string) {
    return this.prisma.evaluationRun.update({
      where: { id },
      data: { status: EvaluationRunStatus.FAILED, completedAt: new Date(), errorMessage },
    });
  }
}
