import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueName, AiEvalRunJob } from '@whatsapp-platform/shared-types';
import { EvaluationCaseStatus, EvaluationVerdict } from '@prisma/client';
import { EvaluationRunService } from './evaluation-run.service';
import { EvaluationRunnerService, RunScenarioResult } from './evaluation-runner.service';
import { COMMERCE_EVAL_SCENARIOS } from './scenarios/commerce-eval-scenarios';

const CONCURRENCY = 4;
const RESPONSE_QUALITY_PASS_THRESHOLD = 3.5;
// Criteria with a hard boolean pass/fail (as opposed to response_quality's 1-5 score).
const REQUIRED_CRITERIA = ['price_accuracy', 'stock_accuracy', 'product_accuracy', 'order_capture', 'payment_handling', 'escalation_behaviour'];

/**
 * Consumes QueueName.AI_EVAL_RUN in-process inside apps/backend (not
 * apps/worker) -- deliberate deviation from this codebase's usual pattern.
 * Every other queue is consumed by a plain-Node bullmq.Worker with a bare
 * PrismaClient and no NestJS DI, which cannot inject CommerceAiService/
 * OrdersService/ProductsService. Re-implementing the tool-calling loop
 * against a bare Prisma client there would mean testing a reimplementation,
 * not the real production-wired service -- see the implementation plan.
 */
@Processor(QueueName.AI_EVAL_RUN)
export class EvaluationProcessor extends WorkerHost {
  private readonly logger = new Logger(EvaluationProcessor.name);

  constructor(
    private runService: EvaluationRunService,
    private runner: EvaluationRunnerService,
  ) {
    super();
  }

  async process(job: Job<AiEvalRunJob>): Promise<void> {
    const { evaluationRunId, tenantId } = job.data;
    await this.runService.markRunning(evaluationRunId);

    try {
      const results = await this.runWithBoundedConcurrency(tenantId, evaluationRunId);

      let skippedCount = 0;
      let anyCriticalFailure = false;
      const criterionTally = new Map<string, { pass: number; total: number }>();
      const qualityScores: number[] = [];

      for (const result of results) {
        if (result.status === EvaluationCaseStatus.SKIPPED) skippedCount++;
        if (result.criticalFailure) anyCriticalFailure = true;

        for (const [key, score] of Object.entries(result.scores as Record<string, { pass?: boolean; score?: number }>)) {
          if (key === 'response_quality' && typeof score.score === 'number') {
            qualityScores.push(score.score);
            continue;
          }
          if (!REQUIRED_CRITERIA.includes(key)) continue;
          const tally = criterionTally.get(key) ?? { pass: 0, total: 0 };
          tally.total++;
          if (score.pass !== false) tally.pass++;
          criterionTally.set(key, tally);
        }
      }

      const allRequiredPassed = [...criterionTally.values()].every((t) => t.pass === t.total);
      const avgQuality = qualityScores.length ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : 5;
      const overallVerdict = !anyCriticalFailure && allRequiredPassed && avgQuality >= RESPONSE_QUALITY_PASS_THRESHOLD
        ? EvaluationVerdict.PASS
        : EvaluationVerdict.FAIL;

      await this.runService.completeRun(evaluationRunId, {
        overallVerdict,
        criticalFailure: anyCriticalFailure,
        skippedCount,
        criteriaSummary: {
          perCriterion: Object.fromEntries([...criterionTally.entries()].map(([k, v]) => [k, { passRate: v.total ? v.pass / v.total : null, ...v }])),
          responseQualityAverage: Math.round(avgQuality * 10) / 10,
        },
      });
    } catch (err) {
      this.logger.error(`Evaluation run ${evaluationRunId} failed`, err);
      await this.runService.failRun(evaluationRunId, err instanceof Error ? err.message : String(err));
    }
  }

  private async runWithBoundedConcurrency(tenantId: string, runId: string) {
    const results: Awaited<ReturnType<EvaluationRunnerService['runScenario']>>[] = [];
    const queue = [...COMMERCE_EVAL_SCENARIOS];

    const worker = async () => {
      while (queue.length > 0) {
        const scenario = queue.shift();
        if (!scenario) return;
        const result: RunScenarioResult = await this.runner.runScenario(tenantId, scenario).catch((err) => {
          this.logger.error(`Scenario ${scenario.key} errored`, err);
          return {
            status: EvaluationCaseStatus.ERRORED,
            contactId: undefined,
            conversationId: undefined,
            orderId: undefined,
            transcript: [],
            scores: {},
            failureReasons: [err instanceof Error ? err.message : String(err)],
            criticalFailure: false,
          };
        });
        results.push(result);
        await this.runService.saveCaseResult(runId, tenantId, {
          scenarioKey: scenario.key,
          criteria: scenario.criteria,
          status: result.status,
          contactId: result.contactId,
          conversationId: result.conversationId,
          orderId: result.orderId,
          transcript: result.transcript,
          scores: result.scores,
          failureReasons: result.failureReasons,
        });
      }
    };

    await Promise.allSettled(Array.from({ length: CONCURRENCY }, () => worker()));
    return results;
  }
}
