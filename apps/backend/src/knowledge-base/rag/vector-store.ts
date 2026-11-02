import { createHash } from 'crypto';
import { cosineSimilarity } from './embedding-provider';

/**
 * Tenant-isolated storage and search of chunk embeddings. Every method takes the tenant id and an implementation must apply it as a
 * filter on every read AND write; `HybridRetriever` additionally drops any hit whose tenant differs, so a faulty store cannot leak.
 */
export interface StoredChunkInput {
  index: number;
  heading: string | null;
  text: string;
  embedding: number[];
}

export interface VectorSearchOptions {
  model: string;
  dimensions: number;
  limit: number;
  /** Cosine similarity (1 = identical direction). Hits below it are not returned: the nearest chunk of an unrelated question is noise. */
  minScore: number;
}

export interface VectorHit {
  tenantId: string;
  articleId: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  title: string;
  score: number;
}

export interface VectorStore {
  /** Replaces every chunk of one article (for one model) in a single step. Returns the rows written. */
  replaceArticleChunks(args: { tenantId: string; articleId: string; contentHash: string; model: string; dimensions: number; chunks: StoredChunkInput[] }): Promise<number>;
  deleteArticleChunks(tenantId: string, articleId: string): Promise<void>;
  /** Only chunks of ACTIVE articles whose content is unchanged since indexing are searched. */
  search(tenantId: string, embedding: number[], options: VectorSearchOptions): Promise<VectorHit[]>;
  hasFreshIndex(tenantId: string, articleId: string, contentHash: string, model: string): Promise<boolean>;
  countChunks(tenantId: string, model: string): Promise<number>;
}

export const VECTOR_STORE = Symbol('VECTOR_STORE');

/** Same value Postgres computes with md5(title || E'\n' || content), so freshness is checkable in SQL without a stored article hash. */
export function contentHashOf(title: string, content: string): string {
  return createHash('md5').update(`${title}\n${content}`, 'utf8').digest('hex');
}

export interface ArticleRecord {
  title: string;
  isActive: boolean;
  contentHash: string;
}

interface MemoryRow {
  tenantId: string;
  articleId: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  contentHash: string;
  model: string;
  dimensions: number;
  embedding: number[];
}

/** Reference implementation for tests and local use. Mirrors the SQL store's rules: tenant filter, active, fresh, model and dimensions. */
export class InMemoryVectorStore implements VectorStore {
  private readonly rowsByTenant = new Map<string, MemoryRow[]>();

  constructor(private readonly articles: (tenantId: string, articleId: string) => ArticleRecord | undefined) {}

  async replaceArticleChunks(args: { tenantId: string; articleId: string; contentHash: string; model: string; dimensions: number; chunks: StoredChunkInput[] }): Promise<number> {
    const article = this.articles(args.tenantId, args.articleId);
    if (!article || article.contentHash !== args.contentHash) return 0; // not this tenant's article, or it changed since it was read
    const rows = (this.rowsByTenant.get(args.tenantId) ?? []).filter((r) => !(r.articleId === args.articleId && r.model === args.model));
    for (const c of args.chunks) {
      rows.push({ tenantId: args.tenantId, articleId: args.articleId, chunkIndex: c.index, heading: c.heading, text: c.text, contentHash: args.contentHash, model: args.model, dimensions: args.dimensions, embedding: c.embedding });
    }
    this.rowsByTenant.set(args.tenantId, rows);
    return args.chunks.length;
  }

  async deleteArticleChunks(tenantId: string, articleId: string): Promise<void> {
    this.rowsByTenant.set(tenantId, (this.rowsByTenant.get(tenantId) ?? []).filter((r) => r.articleId !== articleId));
  }

  async search(tenantId: string, embedding: number[], options: VectorSearchOptions): Promise<VectorHit[]> {
    const hits: VectorHit[] = [];
    for (const row of this.rowsByTenant.get(tenantId) ?? []) {
      if (row.tenantId !== tenantId || row.model !== options.model || row.dimensions !== options.dimensions) continue;
      const article = this.articles(tenantId, row.articleId);
      if (!article || !article.isActive || article.contentHash !== row.contentHash) continue;
      const score = cosineSimilarity(embedding, row.embedding);
      if (score >= options.minScore) hits.push({ tenantId: row.tenantId, articleId: row.articleId, chunkIndex: row.chunkIndex, heading: row.heading, text: row.text, title: article.title, score });
    }
    return hits.sort((a, b) => b.score - a.score || a.articleId.localeCompare(b.articleId) || a.chunkIndex - b.chunkIndex).slice(0, options.limit);
  }

  async hasFreshIndex(tenantId: string, articleId: string, contentHash: string, model: string): Promise<boolean> {
    return (this.rowsByTenant.get(tenantId) ?? []).some((r) => r.articleId === articleId && r.model === model && r.contentHash === contentHash);
  }

  async countChunks(tenantId: string, model: string): Promise<number> {
    return (this.rowsByTenant.get(tenantId) ?? []).filter((r) => r.model === model).length;
  }
}
