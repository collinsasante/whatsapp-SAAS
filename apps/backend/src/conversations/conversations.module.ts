import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AirtableService } from './airtable.service';
import { AiCoreModule } from '../ai-core/ai-core.module';
import { QueueName } from '@whatsapp-platform/shared-types';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.SNOOZE }),
    ActivityLogModule,
    NotificationsModule,
    RealtimeModule,
    // CommerceModule imports ConversationsModule (Phase 2a) AND AiCoreModule now imports
    // CommerceModule back (Verz-AI unification, Phase A) -- that makes this edge part of a
    // 3-module cycle (CommerceModule -> ConversationsModule -> AiCoreModule -> CommerceModule)
    // that didn't exist when this import was first written. forwardRef() needed here too.
    forwardRef(() => AiCoreModule),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService, AirtableService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
