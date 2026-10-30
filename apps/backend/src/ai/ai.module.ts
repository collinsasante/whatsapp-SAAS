import { Module } from '@nestjs/common';
import { AiResponderService } from './ai-responder.service';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ApprovedCorrectionsModule } from '../ai-learning/corrections/approved-corrections.module';
import { DigitalSelfModule } from '../digital-self/digital-self.module';

@Module({
  imports: [KnowledgeBaseModule, ApprovedCorrectionsModule, DigitalSelfModule],
  providers: [AiResponderService],
  exports: [AiResponderService],
})
export class AiModule {}
