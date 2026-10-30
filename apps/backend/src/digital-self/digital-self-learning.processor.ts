import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DigitalSelfLearnJob, QueueName } from '@whatsapp-platform/shared-types';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { DigitalSelfLearningService } from './digital-self-learning.service';
import { DIGITAL_SELF_FLAG_KEY } from './digital-self-learning.trigger';

/**
 * Consumes QueueName.DIGITAL_SELF_LEARN in-process (same deliberate choice as AiInteractionEvalProcessor: it needs NestJS DI).
 * Idempotent through the ledger in DigitalSelfLearningService; a malformed job is dropped, a transient failure is retried by the queue.
 */
@Processor(QueueName.DIGITAL_SELF_LEARN)
export class DigitalSelfLearningProcessor extends WorkerHost {
  private readonly logger = new Logger(DigitalSelfLearningProcessor.name);

  constructor(
    private learning: DigitalSelfLearningService,
    private featureFlags: FeatureFlagsService,
  ) {
    super();
  }

  async process(job: Job<DigitalSelfLearnJob>): Promise<void> {
    const { tenantId, messageId } = job.data ?? ({} as Partial<DigitalSelfLearnJob>);
    if (typeof tenantId !== 'string' || !tenantId || typeof messageId !== 'string' || !messageId) {
      this.logger.warn('Dropping a Digital Self learning job with a missing tenantId or messageId');
      return;
    }
    // Checked again: the job may have been queued before the flag was turned off.
    if (!(await this.featureFlags.isEnabledCached(DIGITAL_SELF_FLAG_KEY, tenantId))) return;

    try {
      await this.learning.learnFromMessage(tenantId, messageId);
    } catch (err) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await this.learning.recordFailure(tenantId, messageId, err);
      throw err;
    }
  }
}
