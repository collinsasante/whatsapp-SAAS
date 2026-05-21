import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { CsatProcessor } from './csat.processor';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { QueueName } from '@whatsapp-platform/shared-types';

@Module({
  imports: [ActivityLogModule, NotificationsModule, RealtimeModule, BullModule.registerQueue({ name: QueueName.CSAT_SURVEY })],
  controllers: [ConversationsController],
  providers: [ConversationsService, CsatProcessor],
  exports: [ConversationsService],
})
export class ConversationsModule {}
