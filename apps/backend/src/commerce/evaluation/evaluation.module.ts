import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommerceModule } from '../commerce.module';
import { EvaluationController } from './evaluation.controller';
import { EvaluationRunService } from './evaluation-run.service';
import { EvaluationRunnerService } from './evaluation-runner.service';
import { EvaluationScoringService } from './evaluation-scoring.service';
import { EvaluationProcessor } from './evaluation.processor';

// Separate module rather than folded into CommerceModule -- this is a testing/QA
// tool with its own admin-only auth posture and a queue consumer, not a piece of
// the core transactional surface. Imports CommerceModule for ProductsService/
// CommerceAiService rather than duplicating their providers.
@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    BullModule.registerQueue({ name: QueueName.AI_EVAL_RUN }),
  ],
  controllers: [EvaluationController],
  providers: [EvaluationRunService, EvaluationRunnerService, EvaluationScoringService, EvaluationProcessor],
})
export class EvaluationModule {}
