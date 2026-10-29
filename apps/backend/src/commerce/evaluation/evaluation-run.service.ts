import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueName, AiEvalRunJob } from '@whatsapp-platform/shared-types';
import { EvaluationCaseStatus, EvaluationRunStatus, EvaluationVerdict } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMERCE_EVAL_SCENARIOS } from './scenarios/commerce-eval-scenarios';
import { SimulationLimitsService } from '../../ai-core/simulation/simulation-limits.service';

@Injectable()
export class EvaluationRunService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue(QueueName.AI_EVAL_RUN) private evalQueue: Queue<AiEvalRunJob>,
    private limits: SimulationLimitsService,
  ) {}

  /**
   * A run is ~15-20 scripted conversations against the real model, so it is the most expensive simulated action. It is limited to a
   * per-tenant daily number of runs (taken atomically) and to one active run at a time. The active-run check is best effort (two
   * simultaneous requests can both pass it); the atomic daily budget is what bounds the total.
   */
  async createRun(tenantId: string, userId: string) {
    const active = await this.prisma.evaluationRun.findFirst({
      where: { tenantId, status: { in: [EvaluationRunStatus.QUEUED, EvaluationRunStatus.RUNNING] } },
      select: { id: true },
    });
    if (active) throw new ConflictException({ statusCode: 409, code: 'EVALUATION_RUN_IN_PROGRESS', message: 'An evaluation run is already queued or running for this workspace. Wait for it to finish.' });
    await this.limits.reserveEvalRun(tenantId);
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
