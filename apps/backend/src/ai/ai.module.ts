import { Module } from '@nestjs/common';
import { AiResponderService } from './ai-responder.service';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { ApprovedCorrectionsModule } from '../ai-learning/corrections/approved-corrections.module';

@Module({
  imports: [KnowledgeBaseModule, ApprovedCorrectionsModule],
  providers: [AiResponderService],
  exports: [AiResponderService],
})
export class AiModule {}
