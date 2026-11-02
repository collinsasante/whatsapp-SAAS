import { capByCharBudget, selectRelevantArticles } from '../knowledge-base.util';
import { buildRetrievalQuery, contentTerms, scoreArticles } from '../knowledge-retrieval.util';
import { EmbeddingProvider } from './embedding-provider';
import { reciprocalRankFusion } from './hybrid-fusion';
import { LexicalReranker, RerankCandidate, Reranker } from './reranker';
import { RetrievalSourceRef, RetrievalTrace } from './retrieval-trace';
import { VectorHit, VectorStore } from './vector-store';

/**
 * Hybrid retrieval over one tenant's knowledge base: keyword scoring (the existing TF-IDF-like scorer) and vector similarity, fused
 * with reciprocal rank fusion, reranked, then capped to the same article and character budget the keyword-only path uses.
 *
 * The keyword-only path stays the floor. Whenever the vector side cannot contribute (no provider, no store, a timeout, an error, an
 * empty or stale index, or no chunk above the similarity threshold) the result is EXACTLY what `selectRelevantArticles` returns, so
 * enabling this can only add recall, never remove what keyword retrieval already found.
 *
 * Tenant isolation: articles come from a tenant-scoped loader; the vector store is asked for this tenant only; and any hit whose
 * tenant differs, or whose article is not in this tenant's active list, is dropped here regardless of what the store returned.
 */
export interface RetrievalArticle {
  id: string;
  title: string;
  content: string;
}

export interface SelectedArticle {
  id: string;
  title: string;
  heading: string | null;
  /** The whole article, or the matching chunks of a long one. */
  content: string;
}

export interface HybridConfig {
  maxArticles: number;
  maxChars: number;
  keywordCandidates: number;
  vectorCandidates: number;
  maxChunksPerArticle: number;
  /** Articles at or below this length are passed whole even when the match came from one chunk. */
  wholeArticleMaxChars: number;
  keywordWeight: number;
  vectorWeight: number;
  rrfK: number;
  minVectorScore: number;
  vectorTimeoutMs: number;
}

export const DEFAULT_HYBRID_CONFIG: HybridConfig = {
  maxArticles: 5,
  maxChars: 6000,
  keywordCandidates: 12,
  vectorCandidates: 12,
  maxChunksPerArticle: 2,
  wholeArticleMaxChars: 1500,
  keywordWeight: 1,
  vectorWeight: 1,
  rrfK: 60,
  minVectorScore: 0.35,
  vectorTimeoutMs: 800,
};

export function readHybridConfig(env: Record<string, string | undefined>, providerDefaults: Partial<HybridConfig> = {}): HybridConfig {
  const num = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const d = { ...DEFAULT_HYBRID_CONFIG, ...providerDefaults };
  return {
    ...d,
    vectorCandidates: num('RAG_VECTOR_CANDIDATES', d.vectorCandidates, 1, 100),
    keywordCandidates: num('RAG_KEYWORD_CANDIDATES', d.keywordCandidates, 1, 100),
    maxChunksPerArticle: num('RAG_MAX_CHUNKS_PER_ARTICLE', d.maxChunksPerArticle, 1, 10),
    keywordWeight: num('RAG_KEYWORD_WEIGHT', d.keywordWeight, 0, 10),
    vectorWeight: num('RAG_VECTOR_WEIGHT', d.vectorWeight, 0, 10),
    rrfK: num('RAG_RRF_K', d.rrfK, 1, 1000),
    minVectorScore: num('RAG_MIN_VECTOR_SCORE', d.minVectorScore, 0, 1),
    vectorTimeoutMs: num('RAG_VECTOR_TIMEOUT_MS', d.vectorTimeoutMs, 50, 10000),
  };
}

export interface HybridRetrieverDeps {
  /** Must return only this tenant's ACTIVE articles, oldest first (the order the keyword-only path uses). */
  loadArticles(tenantId: string): Promise<RetrievalArticle[]>;
  embedder: EmbeddingProvider | null;
  store: VectorStore | null;
  reranker?: Reranker;
  config?: Partial<HybridConfig>;
  warn?(message: string): void;
}

export interface RetrievalResult {
  articles: SelectedArticle[];
  trace: RetrievalTrace;
}

class VectorTimeoutError extends Error {}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new VectorTimeoutError(`vector retrieval exceeded ${ms} ms`)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const titleOf = (title: string) => (title.length > 80 ? `${title.slice(0, 77)}...` : title);

export class HybridRetriever {
  private readonly config: HybridConfig;
  private readonly reranker: Reranker;

  constructor(private readonly deps: HybridRetrieverDeps) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...(deps.config ?? {}) };
    this.reranker = deps.reranker ?? new LexicalReranker();
  }

  async retrieve(tenantId: string, query: string, previousCustomerMessages: string[] = []): Promise<RetrievalResult> {
    const cfg = this.config;
    const articles = await this.deps.loadArticles(tenantId);
    const keywordOnly = (mode: RetrievalTrace['mode'], reason?: string, keywordCount = 0, vectorCount = 0): RetrievalResult => {
      const selected = selectRelevantArticles(articles, query, { maxArticles: cfg.maxArticles, maxChars: cfg.maxChars }, previousCustomerMessages);
      return {
        articles: selected.map((a) => ({ id: a.id, title: a.title, heading: null, content: a.content })),
        trace: {
          mode,
          ...(reason ? { fallbackReason: reason } : {}),
          ...(this.deps.embedder ? { embeddingModel: this.deps.embedder.model } : {}),
          candidates: { keyword: keywordCount, vector: vectorCount },
          sources: selected.map((a, i) => ({ articleId: a.id, title: titleOf(a.title), chunkIndexes: [], via: ['keyword'] as Array<'keyword' | 'vector'>, finalRank: i + 1 })),
        },
      };
    };

    const retrieval = buildRetrievalQuery(query, previousCustomerMessages);
    if (articles.length === 0 || (retrieval.terms.size === 0 && retrieval.hintTerms.size === 0)) return keywordOnly('keyword');
    if (articles.length <= cfg.maxArticles) return keywordOnly('keyword'); // the whole small knowledge base fits; nothing to rank

    const scores = scoreArticles(articles, retrieval);
    const keywordRanked = articles
      .map((article, index) => ({ article, score: scores[index], index }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, cfg.keywordCandidates);

    if (!this.deps.embedder) return keywordOnly('keyword', 'no_embedding_provider', keywordRanked.length);
    if (!this.deps.store) return keywordOnly('keyword', 'no_vector_store', keywordRanked.length);

    let hits: VectorHit[];
    try {
      hits = await withTimeout(this.searchVectors(tenantId, query, previousCustomerMessages), cfg.vectorTimeoutMs);
    } catch (err) {
      const reason = err instanceof VectorTimeoutError ? 'vector_timeout' : 'vector_error';
      this.deps.warn?.(`Vector retrieval skipped for tenant ${tenantId} (${reason}); using keyword retrieval: ${err instanceof Error ? err.message : String(err)}`);
      return { ...keywordOnly('keyword-fallback', reason, keywordRanked.length) };
    }

    const byId = new Map(articles.map((a) => [a.id, a]));
    const vectorByArticle = new Map<string, VectorHit[]>();
    for (const hit of hits) {
      if (hit.tenantId !== tenantId || !byId.has(hit.articleId)) {
        this.deps.warn?.(`Dropped a vector hit that does not belong to tenant ${tenantId}'s active knowledge base`);
        continue;
      }
      vectorByArticle.set(hit.articleId, [...(vectorByArticle.get(hit.articleId) ?? []), hit]);
    }
    if (vectorByArticle.size === 0) return keywordOnly('keyword', 'no_vector_hits', keywordRanked.length);

    const vectorRanked = [...vectorByArticle.entries()]
      .map(([articleId, list]) => ({ articleId, best: Math.max(...list.map((h) => h.score)) }))
      .sort((a, b) => b.best - a.best || a.articleId.localeCompare(b.articleId))
      .slice(0, cfg.vectorCandidates);
    const vectorRank = new Map(vectorRanked.map((v, i) => [v.articleId, i + 1]));
    const keywordRank = new Map(keywordRanked.map((k, i) => [k.article.id, i + 1]));

    const fused = reciprocalRankFusion([
      { name: 'keyword', weight: cfg.keywordWeight, keys: keywordRanked.map((k) => k.article.id) },
      { name: 'vector', weight: cfg.vectorWeight, keys: vectorRanked.map((v) => v.articleId) },
    ], cfg.rrfK);

    const textFor = new Map<string, { content: string; heading: string | null; chunkIndexes: number[] }>();
    const candidates: RerankCandidate[] = fused.map((f) => {
      const article = byId.get(f.key)!;
      const articleHits = (vectorByArticle.get(f.key) ?? []).slice().sort((a, b) => b.score - a.score).slice(0, cfg.maxChunksPerArticle);
      const useChunks = articleHits.length > 0 && article.content.length > cfg.wholeArticleMaxChars;
      const ordered = articleHits.slice().sort((a, b) => a.chunkIndex - b.chunkIndex);
      const content = useChunks ? ordered.map((h) => h.text).join('\n\n') : article.content;
      textFor.set(f.key, { content, heading: useChunks && ordered.every((h) => h.heading === ordered[0].heading) ? ordered[0].heading : null, chunkIndexes: useChunks ? ordered.map((h) => h.chunkIndex) : [] });
      return { key: f.key, title: article.title, text: content, fusedScore: f.score, vectorScore: vectorRanked.find((v) => v.articleId === f.key)?.best };
    });

    const reranked = this.reranker.rerank(retrieval, query, candidates, cfg.maxArticles);
    const selected = capByCharBudget(
      reranked.map((c) => ({ id: c.key, title: c.title, content: textFor.get(c.key)!.content })),
      cfg.maxChars,
    );
    const picked: SelectedArticle[] = selected.map((s) => ({ id: s.id, title: s.title, heading: textFor.get(s.id)!.heading, content: s.content }));
    const sources: RetrievalSourceRef[] = picked.map((p, i) => {
      const kRank = keywordRank.get(p.id);
      const vRank = vectorRank.get(p.id);
      const best = vectorRanked.find((v) => v.articleId === p.id)?.best;
      return {
        articleId: p.id,
        title: titleOf(p.title),
        chunkIndexes: textFor.get(p.id)!.chunkIndexes,
        via: [...(kRank ? (['keyword'] as const) : []), ...(vRank ? (['vector'] as const) : [])],
        ...(kRank ? { keywordRank: kRank } : {}),
        ...(vRank ? { vectorRank: vRank, vectorScore: Math.round((best ?? 0) * 1000) / 1000 } : {}),
        finalRank: i + 1,
      };
    });
    return {
      articles: picked,
      trace: { mode: 'hybrid', embeddingModel: this.deps.embedder.model, candidates: { keyword: keywordRanked.length, vector: vectorRanked.length }, sources },
    };
  }

  private async searchVectors(tenantId: string, query: string, previous: string[]): Promise<VectorHit[]> {
    const embedder = this.deps.embedder!;
    // A thin follow-up ("and the 500g?") is embedded together with the customer's previous message, as the keyword query is.
    const thin = contentTerms(query).length < 2 && previous.length > 0;
    const text = thin ? `${previous[previous.length - 1]} ${query}` : query;
    const [vector] = await embedder.embed([text], 'query');
    if (!vector || vector.length !== embedder.dimensions) throw new Error('the embedding provider returned a vector of the wrong size');
    return this.deps.store!.search(tenantId, vector, {
      model: embedder.model,
      dimensions: embedder.dimensions,
      limit: this.config.vectorCandidates * this.config.maxChunksPerArticle,
      minScore: this.config.minVectorScore,
    });
  }
}
