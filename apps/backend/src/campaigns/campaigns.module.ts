import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { ScheduledCampaignProcessor } from './scheduled-campaign.processor';
import { QueueName } from '@whatsapp-platform/shared-types';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QueueName.CAMPAIGN_SEND },
      { name: QueueName.SCHEDULED_CAMPAIGN },
    ),
  ],
  controllers: [CampaignsController],
  providers: [CampaignsService, ScheduledCampaignProcessor],
  exports: [CampaignsService],
})
export class CampaignsModule {}
