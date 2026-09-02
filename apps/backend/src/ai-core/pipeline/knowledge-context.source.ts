import { Injectable } from '@nestjs/common';
import { KnowledgeBaseService } from '../../knowledge-base/knowledge-base.service';

/**
 * Abstraction point for Phase 3's RAG work to swap in real vector retrieval
 * without touching ContextAssemblyStage. The Phase 1 implementation matches
 * the legacy responder's CURRENT behavior exactly: bounded, relevance-filtered
 * KB context via KnowledgeBaseService.getRelevant() (not a full-dump -- that
 * changed since this pipeline was first planned; getRelevant() already caps
 * article count/chars, see knowledge-base.service.ts).
 */
export interface KnowledgeContextSource {
  getContext(tenantId: string, query: string): Promise<string>;
}

/** DI token -- interfaces don't exist at runtime, so this is what makes the
 * source swappable (Phase 3 RAG rebinds this token to a vector-backed impl). */
export const KNOWLEDGE_CONTEXT_SOURCE = Symbol('KNOWLEDGE_CONTEXT_SOURCE');

@Injectable()
export class KbRelevantContextSource implements KnowledgeContextSource {
  constructor(private knowledgeBase: KnowledgeBaseService) {}

  async getContext(tenantId: string, query: string): Promise<string> {
    const articles = await this.knowledgeBase.getRelevant(tenantId, query);
    if (articles.length === 0) return '';
    return '\n\nKNOWLEDGE BASE:\n' + articles.map((a) => `## ${a.title}\n${a.content}`).join('\n\n');
  }
}
