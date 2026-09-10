import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { PrismaModule } from '../prisma/prisma.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { InternalTasksModule } from '../internal-tasks/internal-tasks.module';
import { AiLearningTriggerService } from './ai-learning-trigger.service';
import { InteractionContextResolver } from './interaction-context.resolver';
import { AiInteractionEvaluatorService } from './ai-interaction-evaluator.service';
import { AiInteractionEvalProcessor } from './ai-interaction-eval.processor';
import { AiLearningService } from './ai-learning.service';
import { AiLearningController } from './ai-learning.controller';

/**
 * AI Learning & Evaluation System. Deliberately standalone -- does not
 * import AiCoreModule (no dependency on ToolRegistryService/pipeline/etc,
 * only on the already-persisted AiExecution/AiInteractionLog rows it reads
 * back). AiCoreModule imports THIS module (one-directional, no forwardRef
 * needed) so AiExecutionsService can inject AiLearningTriggerService --
 * see the comment on AiCoreModule's providers list.
 */
@Module({
  imports: [
    PrismaModule,
    FeatureFlagsModule,
    InternalTasksModule,
    BullModule.registerQueue({ name: QueueName.AI_INTERACTION_EVAL }),
  ],
  controllers: [AiLearningController],
  providers: [
    AiLearningTriggerService,
    InteractionContextResolver,
    AiInteractionEvaluatorService,
    AiInteractionEvalProcessor,
    AiLearningService,
  ],
  exports: [AiLearningTriggerService],
})
export class AiLearningModule {}
