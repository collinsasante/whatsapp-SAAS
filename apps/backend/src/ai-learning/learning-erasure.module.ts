import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LearningErasureService } from './learning-erasure.service';

/** Small and cycle-free (Prisma, notifications, one queue handle) so Contacts and Conversations can both import it. */
@Module({
  imports: [PrismaModule, NotificationsModule, BullModule.registerQueue({ name: QueueName.AI_INTERACTION_EVAL })],
  providers: [LearningErasureService],
  exports: [LearningErasureService],
})
export class LearningErasureModule {}
