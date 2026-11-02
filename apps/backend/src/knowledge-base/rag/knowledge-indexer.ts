import { Chunk, chunkDocument, ChunkOptions } from './semantic-chunker';
import { EmbeddingProvider, EmbeddingUnavailableError } from './embedding-provider';
import { contentHashOf, VectorStore } from './vector-store';

/**
 * Builds the vector index for one tenant, only when asked: nothing calls this automatically, so enabling hybrid retrieval never
 * re-embeds or touches existing knowledge-base rows. Articles whose content has not changed since they were indexed are skipped.
 * `dryRun` needs no provider and no store; it reports how many chunks and roughly how many tokens an index would cost to embed, so a
 * provider and budget can be chosen before any money is spent.
 */
export interface IndexableArticle {
  id: string;
  title: string;
  content: string;
}

export interface IndexReport {
  tenantId: string;
  dryRun: boolean;
  articles: number;
  alreadyFresh: number;
  chunks: number;
  /** characters / 4: the usual rough rule for English; providers report exact figures. */
  estimatedTokens: number;
  embeddedChunks: number;
  rowsWritten: number;
}

export interface KnowledgeIndexerDeps {
  /** Must return only this tenant's active articles. */
  loadActiveArticles(tenantId: string): Promise<IndexableArticle[]>;
  embedder: EmbeddingProvider | null;
  store: VectorStore | null;
  chunkOptions?: Partial<ChunkOptions>;
  /** Texts per embedding request. */
  batchSize?: number;
}

export function embeddingTextOf(title: string, chunk: Chunk): string {
  return `${title}\n${chunk.heading ? `${chunk.heading}\n` : ''}${chunk.text}`;
}

export class KnowledgeIndexer {
  constructor(private readonly deps: KnowledgeIndexerDeps) {}

  async indexTenant(tenantId: string, options: { dryRun?: boolean; force?: boolean } = {}): Promise<IndexReport> {
    const dryRun = options.dryRun === true;
    const { embedder, store } = this.deps;
    if (!dryRun && (!embedder || !store)) throw new EmbeddingUnavailableError('Indexing needs both an embedding provider and a vector store');
    const batchSize = Math.max(1, Math.min(this.deps.batchSize ?? 64, 256));

    const articles = await this.deps.loadActiveArticles(tenantId);
    const report: IndexReport = { tenantId, dryRun, articles: articles.length, alreadyFresh: 0, chunks: 0, estimatedTokens: 0, embeddedChunks: 0, rowsWritten: 0 };

    for (const article of articles) {
      const hash = contentHashOf(article.title, article.content);
      if (!dryRun && !options.force && (await store!.hasFreshIndex(tenantId, article.id, hash, embedder!.model))) {
        report.alreadyFresh++;
        continue;
      }
      const chunks = chunkDocument(article.content, this.deps.chunkOptions);
      const texts = chunks.map((c) => embeddingTextOf(article.title, c));
      report.chunks += chunks.length;
      report.estimatedTokens += Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);
      if (dryRun) continue;

      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = await embedder!.embed(texts.slice(i, i + batchSize), 'document');
        if (batch.length !== Math.min(batchSize, texts.length - i)) throw new Error('the embedding provider returned the wrong number of vectors');
        vectors.push(...batch);
      }
      report.embeddedChunks += vectors.length;
      report.rowsWritten += await store!.replaceArticleChunks({
        tenantId, articleId: article.id, contentHash: hash, model: embedder!.model, dimensions: embedder!.dimensions,
        chunks: chunks.map((c, i) => ({ index: c.index, heading: c.heading, text: c.text, embedding: vectors[i] })),
      });
    }
    return report;
  }
}
