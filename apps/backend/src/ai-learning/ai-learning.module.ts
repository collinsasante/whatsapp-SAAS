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
import { SimulationLimitsModule } from '../ai-core/simulation/simulation-limits.module';
import { DigitalSelfModule } from '../digital-self/digital-self.module';
import { AiProvidersModule } from '../ai-core/providers/ai-providers.module';
import { AiLearningCostService } from './learning-cost.service';
import { AiLearningSettingsService } from './learning-settings.service';
import { AiLearningRetentionService } from './learning-retention.service';
import { AiLearningRetentionController } from './learning-retention.controller';
import { LEARNING_COST_CONFIG, loadLearningCostConfig } from './learning-cost.config';

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
    SimulationLimitsModule,
    DigitalSelfModule,
    AiProvidersModule,
    BullModule.registerQueue({ name: QueueName.AI_INTERACTION_EVAL }),
  ],
  controllers: [AiLearningController, AiLearningRetentionController],
  providers: [
    AiLearningTriggerService,
    InteractionContextResolver,
    AiInteractionEvaluatorService,
    AiInteractionEvalProcessor,
    AiLearningService,
    AiLearningCostService,
    AiLearningSettingsService,
    AiLearningRetentionService,
    { provide: LEARNING_COST_CONFIG, useFactory: () => loadLearningCostConfig() },
  ],
  exports: [AiLearningTriggerService, AiLearningCostService],
})
export class AiLearningModule {}
