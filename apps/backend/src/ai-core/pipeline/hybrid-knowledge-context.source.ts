import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { KnowledgeBaseService } from '../../knowledge-base/knowledge-base.service';
import { ApprovedCorrectionsService } from '../../ai-learning/corrections/approved-corrections.service';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../../knowledge-base/rag/embedding-provider';
import { HybridRetriever, readHybridConfig, RetrievalResult, SelectedArticle } from '../../knowledge-base/rag/hybrid-retriever';
import { RetrievalTrace } from '../../knowledge-base/rag/retrieval-trace';
import { VECTOR_STORE, VectorStore } from '../../knowledge-base/rag/vector-store';
import { KnowledgeContextSource } from './knowledge-context.source';

const formatArticle = (a: SelectedArticle): string => `## ${a.title}${a.heading ? ` - ${a.heading}` : ''}\n${a.content}`;

/**
 * Hybrid (keyword + vector, fused and reranked) knowledge context behind the same `KnowledgeContextSource` seam the pipeline already
 * uses, so ContextAssemblyStage is untouched apart from reading the optional trace. The text it produces has exactly the shape of
 * `KbRelevantContextSource` (a "KNOWLEDGE BASE:" block of "## title" sections, then the approved-corrections guidance), and when the
 * vector side cannot help it returns the keyword-only selection unchanged. Bound only when RAG_HYBRID_ENABLED=true.
 */
@Injectable()
export class HybridKnowledgeContextSource implements KnowledgeContextSource {
  private readonly logger = new Logger(HybridKnowledgeContextSource.name);
  private readonly retriever: HybridRetriever;

  constructor(
    private knowledgeBase: KnowledgeBaseService,
    private corrections: ApprovedCorrectionsService,
    @Optional() @Inject(EMBEDDING_PROVIDER) embedder?: EmbeddingProvider | null,
    @Optional() @Inject(VECTOR_STORE) store?: VectorStore | null,
  ) {
    this.retriever = new HybridRetriever({
      loadArticles: (tenantId) => this.knowledgeBase.getActiveForRetrieval(tenantId),
      embedder: embedder ?? null,
      store: store ?? null,
      config: readHybridConfig(process.env, embedder?.recommendedMinVectorScore !== undefined ? { minVectorScore: embedder.recommendedMinVectorScore } : {}),
      warn: (message) => this.logger.warn(message),
    });
  }

  async getContext(tenantId: string, query: string, previousCustomerMessages: string[] = []): Promise<string> {
    return (await this.getContextWithTrace(tenantId, query, previousCustomerMessages)).context;
  }

  async getContextWithTrace(tenantId: string, query: string, previousCustomerMessages: string[] = []): Promise<{ context: string; trace: RetrievalTrace }> {
    let result: RetrievalResult;
    try {
      result = await this.retriever.retrieve(tenantId, query, previousCustomerMessages);
    } catch (err) {
      // Anything unexpected falls back to the existing keyword path, which behaves (and fails) exactly as before this feature.
      this.logger.warn(`Hybrid retrieval failed for tenant ${tenantId}; using keyword retrieval: ${err instanceof Error ? err.message : String(err)}`);
      const articles = await this.knowledgeBase.getRelevant(tenantId, query, previousCustomerMessages);
      result = {
        articles: articles.map((a) => ({ id: '', title: a.title, heading: null, content: a.content })),
        trace: { mode: 'keyword-fallback', fallbackReason: 'retriever_error', candidates: { keyword: 0, vector: 0 }, sources: [] },
      };
    }
    // Rides in the same template variable as the KB, so no stored prompt template has to change.
    const guidance = await this.corrections.getGuidanceBlock(tenantId, query).catch(() => '');
    const context = result.articles.length === 0 ? guidance : '\n\nKNOWLEDGE BASE:\n' + result.articles.map(formatArticle).join('\n\n') + guidance;
    return { context, trace: result.trace };
  }
}
