import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueName, ScheduledCampaignJob } from '@whatsapp-platform/shared-types';
import { CampaignsService } from './campaigns.service';

/**
 * Consumes QueueName.SCHEDULED_CAMPAIGN in-process (it needs CampaignsService, which already queues the real send batches). Until
 * this existed, a campaign launched with a future date was queued here and never picked up, so it stayed SCHEDULED forever.
 * Safe to deliver twice and safe after a restart: starting is one conditional write on a campaign that is still SCHEDULED, and the
 * delayed job lives in Redis. A transient failure is retried by the queue; the last failed attempt marks the campaign FAILED.
 */
@Processor(QueueName.SCHEDULED_CAMPAIGN)
export class ScheduledCampaignProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledCampaignProcessor.name);

  constructor(private campaigns: CampaignsService) {
    super();
  }

  async process(job: Job<ScheduledCampaignJob>): Promise<void> {
    const { campaignId, tenantId } = job.data ?? ({} as Partial<ScheduledCampaignJob>);
    if (typeof campaignId !== 'string' || !campaignId || typeof tenantId !== 'string' || !tenantId) {
      this.logger.warn('Dropping a scheduled-campaign job with a missing campaignId or tenantId');
      return;
    }
    const result = await this.campaigns.startScheduled(tenantId, campaignId);
    if (result.started) this.logger.log(`Scheduled campaign ${campaignId} started: ${result.batches} batch(es) queued`);
    else this.logger.log(`Scheduled campaign ${campaignId} not started: ${result.reason}`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ScheduledCampaignJob> | undefined, error: Error): Promise<void> {
    if (!job?.data?.campaignId || !job.data.tenantId) return;
    const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.error(`Scheduled launch of campaign ${job.data.campaignId} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}): ${error.message}`);
    if (finalAttempt) await this.campaigns.markScheduledLaunchFailed(job.data.tenantId, job.data.campaignId);
  }
}
