import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AirtableService } from './airtable.service';
import { QueueName } from '@whatsapp-platform/shared-types';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.SNOOZE }),
    ActivityLogModule,
    NotificationsModule,
    RealtimeModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService, AirtableService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
