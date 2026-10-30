import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { PrismaModule } from '../prisma/prisma.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { DigitalSelfService } from './digital-self.service';
import { DigitalSelfLearningService } from './digital-self-learning.service';
import { DigitalSelfLearningTrigger } from './digital-self-learning.trigger';
import { DigitalSelfLearningProcessor } from './digital-self-learning.processor';

/** AI Digital Self. A leaf module (Prisma, feature flags, one queue) so messages, conversations and the AI pipelines can all import it without cycles. */
@Module({
  imports: [PrismaModule, FeatureFlagsModule, BullModule.registerQueue({ name: QueueName.DIGITAL_SELF_LEARN })],
  providers: [DigitalSelfService, DigitalSelfLearningService, DigitalSelfLearningTrigger, DigitalSelfLearningProcessor],
  exports: [DigitalSelfService, DigitalSelfLearningTrigger],
})
export class DigitalSelfModule {}
