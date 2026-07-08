import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EMBEDDING_SERVICE } from './embeddings/embedding.module';
import { EmbeddingService, cosineSimilarity } from './embeddings/embedding.service';

export interface RetrievedChunk {
  id: string;
  articleId: string;
  heading: string | null;
  content: string;
  score: number;
  matchedBy: ('vector' | 'fts')[];
}

const TOP_K = 6;
const OVER_FETCH = TOP_K * 3;
const VECTOR_WEIGHT = 0.6;
const FTS_WEIGHT = 0.4;

function minMaxNormalize(values: number[]): number[] {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min;
  if (range === 0) return values.map(() => (max > 0 ? 1 : 0));
  return values.map((v) => (v - min) / range);
}

/**
 * Hybrid retrieval: vector cosine similarity (semantic, via EmbeddingService)
 * merged with Postgres full-text search (lexical, exact terms/product names/
 * spellings the hashed-embedding fallback won't reliably catch). Every query
 * filters on tenantId directly on knowledge_base_chunks -- never relies on a
 * join alone for tenant isolation.
 */
@Injectable()
export class RetrievalService {
  constructor(
    private prisma: PrismaService,
    @Inject(EMBEDDING_SERVICE) private embeddingService: EmbeddingService,
  ) {}

  /**
   * @param recentContext Optional condensed prior turn (e.g. the last outbound
   *   message) appended to the retrieval query so pronouns like "how much is
   *   it?" have a fighting chance of matching the right product/topic without
   *   an extra LLM call to rewrite the query.
   */
  async retrieve(tenantId: string, message: string, recentContext?: string): Promise<RetrievedChunk[]> {
    const retrievalQuery = recentContext ? `${recentContext}\n${message}` : message;

    const [vectorHits, ftsHits] = await Promise.all([
      this.vectorSearch(tenantId, retrievalQuery),
      this.fullTextSearch(tenantId, retrievalQuery),
    ]);

    return this.merge(vectorHits, ftsHits).slice(0, TOP_K);
  }

  private async vectorSearch(tenantId: string, query: string): Promise<{ id: string; articleId: string; heading: string | null; content: string; score: number }[]> {
    const [queryEmbedding] = await this.embeddingService.embed([query]);

    const chunks = await this.prisma.knowledgeBaseChunk.findMany({
      where: { tenantId, article: { isActive: true } },
      select: { id: true, articleId: true, heading: true, content: true, embedding: true },
    });

    return chunks
      .map((c) => ({
        id: c.id, articleId: c.articleId, heading: c.heading, content: c.content,
        score: Math.max(0, cosineSimilarity(queryEmbedding, c.embedding)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, OVER_FETCH);
  }

  private async fullTextSearch(tenantId: string, query: string): Promise<{ id: string; articleId: string; heading: string | null; content: string; score: number }[]> {
    // plainto_tsquery on a query with no meaningful lexical tokens (e.g. just
    // punctuation, or all stopwords) returns an empty tsquery that matches
    // nothing -- that's the correct behavior here, not an error to handle.
    const rows = await this.prisma.$queryRaw<{ id: string; article_id: string; heading: string | null; content: string; rank: number }[]>`
      SELECT kbc.id, kbc.article_id, kbc.heading, kbc.content,
             ts_rank(kbc.content_tsv, plainto_tsquery('english', ${query})) AS rank
      FROM knowledge_base_chunks kbc
      JOIN knowledge_base_articles kba ON kba.id = kbc.article_id
      WHERE kbc.tenant_id = ${tenantId}
        AND kba.is_active = true
        AND kbc.content_tsv @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${OVER_FETCH}
    `;
    return rows.map((r) => ({ id: r.id, articleId: r.article_id, heading: r.heading, content: r.content, score: r.rank }));
  }

  private merge(
    vectorHits: { id: string; articleId: string; heading: string | null; content: string; score: number }[],
    ftsHits: { id: string; articleId: string; heading: string | null; content: string; score: number }[],
  ): RetrievedChunk[] {
    const vectorScores = minMaxNormalize(vectorHits.map((h) => h.score));
    const ftsScores = minMaxNormalize(ftsHits.map((h) => h.score));

    const byId = new Map<string, RetrievedChunk>();

    vectorHits.forEach((h, i) => {
      byId.set(h.id, {
        id: h.id, articleId: h.articleId, heading: h.heading, content: h.content,
        score: vectorScores[i] * VECTOR_WEIGHT,
        matchedBy: ['vector'],
      });
    });

    ftsHits.forEach((h, i) => {
      const existing = byId.get(h.id);
      const ftsContribution = ftsScores[i] * FTS_WEIGHT;
      if (existing) {
        existing.score += ftsContribution;
        existing.matchedBy.push('fts');
      } else {
        byId.set(h.id, {
          id: h.id, articleId: h.articleId, heading: h.heading, content: h.content,
          score: ftsContribution,
          matchedBy: ['fts'],
        });
      }
    });

    return [...byId.values()].sort((a, b) => b.score - a.score);
  }
}
