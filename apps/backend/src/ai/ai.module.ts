import { Module } from '@nestjs/common';
import { AiResponderService } from './ai-responder.service';
import { RetrievalService } from './retrieval.service';
import { VerificationService } from './verification.service';
import { EscalationService } from './escalation.service';
import { LlmService } from './llm.service';
import { EmbeddingModule } from './embeddings/embedding.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';

@Module({
  imports: [KnowledgeBaseModule, EmbeddingModule],
  providers: [AiResponderService, RetrievalService, VerificationService, EscalationService, LlmService],
  exports: [AiResponderService, EscalationService, RetrievalService],
})
export class AiModule {}
