import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DigitalSelfLearnJob, QueueName } from '@whatsapp-platform/shared-types';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

/** Per-tenant kill switch. Provisioning is always on; LEARNING and USING a style are off until this flag is enabled for the tenant
 * (fail-closed, like ai_learning_system), because learning from a business's agent messages needs that business's authorization. */
export const DIGITAL_SELF_FLAG_KEY = 'digital_self';

export const learnJobId = (messageId: string): string => `digital-self-learn-${messageId}`;

@Injectable()
export class DigitalSelfLearningTrigger {
  private readonly logger = new Logger(DigitalSelfLearningTrigger.name);

  constructor(
    private featureFlags: FeatureFlagsService,
    @InjectQueue(QueueName.DIGITAL_SELF_LEARN) private queue: Queue<DigitalSelfLearnJob>,
  ) {}

  /** Fire-and-forget from the send path: a flag lookup and a queue add. Never throws and never delays the agent's send. */
  async enqueue(tenantId: string, messageId: string): Promise<void> {
    try {
      if (!(await this.featureFlags.isEnabledCached(DIGITAL_SELF_FLAG_KEY, tenantId))) return;
      await this.queue.add('learn', { tenantId, messageId }, {
        jobId: learnJobId(messageId),
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
    } catch (err) {
      this.logger.warn(`Could not queue Digital Self learning: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
}
