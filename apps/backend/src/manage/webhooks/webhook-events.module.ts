import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebhookEventsService } from './webhook-events.service';

/** Global so RealtimeService (also global) can fire tenant webhooks without import cycles. */
@Global()
@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: QueueName.WEBHOOK_PROCESS })],
  providers: [WebhookEventsService],
  exports: [WebhookEventsService],
})
export class WebhookEventsModule {}
