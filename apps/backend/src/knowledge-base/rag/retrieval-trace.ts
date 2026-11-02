/**
 * What a retrieval returned and why, so a reply can be traced back to the articles that informed it. Holds ids, titles, ranks and
 * scores only; never article content or a customer's words. Stored with the execution (safetyFlags.retrieval).
 */
export type RetrievalMode = 'keyword' | 'hybrid' | 'keyword-fallback';

export interface RetrievalSourceRef {
  articleId: string;
  /** Truncated: enough to recognise the article, not the article itself. */
  title: string;
  /** The chunks used when only part of a long article was passed on; empty when the whole article was. */
  chunkIndexes: number[];
  via: Array<'keyword' | 'vector'>;
  keywordRank?: number;
  vectorRank?: number;
  vectorScore?: number;
  finalRank: number;
}

export interface RetrievalTrace {
  mode: RetrievalMode;
  /** Why the vector side was skipped, when it was: 'no_embedding_provider', 'no_vector_store', 'vector_timeout', 'vector_error', ... */
  fallbackReason?: string;
  embeddingModel?: string;
  candidates: { keyword: number; vector: number };
  sources: RetrievalSourceRef[];
}
