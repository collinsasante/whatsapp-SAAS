import { Module } from '@nestjs/common';
import { AiResponderService } from './ai-responder.service';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';

@Module({
  imports: [KnowledgeBaseModule],
  providers: [AiResponderService],
  exports: [AiResponderService],
})
export class AiModule {}
