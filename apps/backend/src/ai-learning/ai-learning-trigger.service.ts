import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueName, AiInteractionEvalJob, AiTaskType } from '@whatsapp-platform/shared-types';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

/** The one feature flag key that gates the entire AI Learning system --
 * created via the existing feature-flags admin API/UI, rolloutType
 * 'tenants' with only the Pakkmax tenant id in betaTenants (or a
 * FeatureFlagRollout row for it). Not created automatically by this module;
 * an evaluator with no flag configured is simply always off (fail-closed --
 * see FeatureFlagsService.isEnabled: no flag row found returns false). */
export const AI_LEARNING_FLAG_KEY = 'ai_learning_system';

/** Only a real customer-facing conversational reply is worth evaluating --
 * SUMMARIZE/KB_LEARN/TEST/LEAD_SCORE are internal/background AI usage, not
 * "how did Verz do in front of a customer" (spec section 5/71). */
const EVALUABLE_TASK_TYPES: AiTaskType[] = ['RESPONDER'];

@Injectable()
export class AiLearningTriggerService {
  private readonly logger = new Logger(AiLearningTriggerService.name);

  constructor(
    private featureFlags: FeatureFlagsService,
    @InjectQueue(QueueName.AI_INTERACTION_EVAL) private queue: Queue<AiInteractionEvalJob>,
  ) {}

  /**
   * Called from AiExecutionsService.record() right after every AiExecution
   * row is created -- the single point every real AI call already converges
   * on. Fire-and-forget from the caller's perspective (never throws, never
   * blocks the customer response): a flag lookup + a queue.add() is the only
   * synchronous cost, the evaluation itself happens later in the processor.
   */
  async maybeEnqueue(input: { tenantId: string; aiExecutionId: string; taskType: string; conversationId?: string | null }): Promise<void> {
    if (!EVALUABLE_TASK_TYPES.includes(input.taskType as AiTaskType)) return;
    if (!input.conversationId) return;

    try {
      const enabled = await this.featureFlags.isEnabledCached(AI_LEARNING_FLAG_KEY, input.tenantId);
      if (!enabled) return;
      await this.queue.add(
        'evaluate',
        { aiExecutionId: input.aiExecutionId, tenantId: input.tenantId },
        // Interaction linking (AiExecutionsService.linkInteractionLog) happens
        // a few lines after record() returns in messages.service.ts, i.e.
        // strictly before this job would ever actually run -- backoff is a
        // safety margin against processor start-up races, not a requirement.
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 500, removeOnFail: 500 },
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue AI interaction evaluation for execution ${input.aiExecutionId}: ${String(err)}`);
    }
  }
}
