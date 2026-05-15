import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ModuleRef } from '@nestjs/core';
import { QueueName, CsatSurveyJob } from '@whatsapp-platform/shared-types';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Processor(QueueName.CSAT_SURVEY)
export class CsatProcessor extends WorkerHost {
  private readonly logger = new Logger(CsatProcessor.name);

  constructor(private moduleRef: ModuleRef) {
    super();
  }

  async process(job: Job<CsatSurveyJob>): Promise<void> {
    const { tenantId, conversationId, contactPhone } = job.data;
    try {
      const whatsapp = this.moduleRef.get(WhatsAppService, { strict: false });
      await whatsapp.sendCsatSurvey(tenantId, contactPhone);
      this.logger.log(`CSAT survey sent for conversation ${conversationId}`);
    } catch (err) {
      this.logger.error(`Failed to send CSAT survey for ${conversationId}: ${err}`);
      throw err; // triggers retry
    }
  }
}
