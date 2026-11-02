import { Injectable } from '@nestjs/common';
import { KnowledgeBaseService } from '../../knowledge-base/knowledge-base.service';
import { ApprovedCorrectionsService } from '../../ai-learning/corrections/approved-corrections.service';
import { RetrievalTrace } from '../../knowledge-base/rag/retrieval-trace';

/**
 * Abstraction point for Phase 3's RAG work to swap in real vector retrieval
 * without touching ContextAssemblyStage. The Phase 1 implementation matches
 * the legacy responder's CURRENT behavior exactly: bounded, relevance-filtered
 * KB context via KnowledgeBaseService.getRelevant() (not a full-dump -- that
 * changed since this pipeline was first planned; getRelevant() already caps
 * article count/chars, see knowledge-base.service.ts).
 */
export interface KnowledgeContextSource {
  getContext(tenantId: string, query: string, previousCustomerMessages?: string[]): Promise<string>;
  /** Optional: the same context plus which articles informed it, for tracing. Sources that do not track this simply omit it. */
  getContextWithTrace?(tenantId: string, query: string, previousCustomerMessages?: string[]): Promise<{ context: string; trace: RetrievalTrace }>;
}

/** DI token -- interfaces don't exist at runtime, so this is what makes the
 * source swappable (Phase 3 RAG rebinds this token to a vector-backed impl). */
export const KNOWLEDGE_CONTEXT_SOURCE = Symbol('KNOWLEDGE_CONTEXT_SOURCE');

@Injectable()
export class KbRelevantContextSource implements KnowledgeContextSource {
  constructor(private knowledgeBase: KnowledgeBaseService, private corrections: ApprovedCorrectionsService) {}

  async getContext(tenantId: string, query: string, previousCustomerMessages: string[] = []): Promise<string> {
    const articles = await this.knowledgeBase.getRelevant(tenantId, query, previousCustomerMessages);
    // Rides in the same template variable as the KB, so no stored prompt template has to change.
    const guidance = await this.corrections.getGuidanceBlock(tenantId, query).catch(() => '');
    if (articles.length === 0) return guidance;
    return '\n\nKNOWLEDGE BASE:\n' + articles.map((a) => `## ${a.title}\n${a.content}`).join('\n\n') + guidance;
  }
}
