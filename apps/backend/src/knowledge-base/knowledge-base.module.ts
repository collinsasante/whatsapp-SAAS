import { forwardRef, Module } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { AiCoreModule } from '../ai-core/ai-core.module';

@Module({
  // AiCoreModule already imports KnowledgeBaseModule (for KbRelevantContextSource's
  // dependency on KnowledgeBaseService), so this edge -- needed for AiCompletionService
  // in learnFromConversations -- is circular. forwardRef() on both sides has existing
  // precedent in this codebase (CallsModule <-> WhatsappModule <-> MessagesModule).
  imports: [forwardRef(() => AiCoreModule)],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
