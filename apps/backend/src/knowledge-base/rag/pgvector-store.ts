import { StoredChunkInput, VectorHit, VectorSearchOptions, VectorStore } from './vector-store';

/**
 * PostgreSQL + pgvector implementation. IMPORTANT: this needs the `vector` extension, which the stock `postgres:16-alpine` image used
 * by production, staging and dev does not ship. So the schema below is deliberately NOT a Prisma migration (a migration would make
 * `prisma migrate deploy` fail on every database that lacks the extension). It is applied explicitly, by `ensurePgVectorSchema`,
 * once a database image that includes pgvector is in place.
 *
 * Tenant isolation, at every statement:
 *   - reads filter on chunk.tenant_id AND article.tenant_id AND article.is_active, joined on the article id;
 *   - writes are `INSERT ... SELECT FROM knowledge_base_articles WHERE id = $article AND tenant_id = $tenant AND md5(...) = $hash`,
 *     so a chunk can only be stored for an article the tenant owns, and only for the exact content that was embedded;
 *   - a chunk is searched only while md5(title || '\n' || content) still equals the hash stored with it, so an edited article's old
 *     vectors are ignored automatically, with no trigger needed (the keyword path keeps serving it meanwhile).
 */
export interface RawSqlClient {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $transaction<T>(fn: (tx: RawSqlClient) => Promise<T>): Promise<T>;
}

export const PGVECTOR_TABLE = 'kb_vector_chunks';

export const PGVECTOR_SCHEMA_STATEMENTS: readonly string[] = [
  'CREATE EXTENSION IF NOT EXISTS vector',
  `CREATE TABLE IF NOT EXISTS ${PGVECTOR_TABLE} (
     id          BIGSERIAL PRIMARY KEY,
     tenant_id   TEXT        NOT NULL,
     article_id  TEXT        NOT NULL REFERENCES knowledge_base_articles(id) ON DELETE CASCADE,
     chunk_index INTEGER     NOT NULL,
     heading     TEXT,
     text        TEXT        NOT NULL,
     content_md5 TEXT        NOT NULL,
     model       TEXT        NOT NULL,
     dims        INTEGER     NOT NULL,
     embedding   vector      NOT NULL,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, article_id, model, chunk_index)
   )`,
  `CREATE INDEX IF NOT EXISTS ${PGVECTOR_TABLE}_tenant_model_idx ON ${PGVECTOR_TABLE} (tenant_id, model)`,
];

export async function ensurePgVectorSchema(db: RawSqlClient): Promise<void> {
  for (const statement of PGVECTOR_SCHEMA_STATEMENTS) await db.$executeRawUnsafe(statement);
}

/** True only when the extension is installed and the table exists. Used to decide whether the vector side may run at all. */
export async function isPgVectorReady(db: RawSqlClient): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe<Array<{ ext: boolean; tbl: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ext, to_regclass('${PGVECTOR_TABLE}') IS NOT NULL AS tbl`,
    );
    return Boolean(rows[0]?.ext && rows[0]?.tbl);
  } catch {
    return false;
  }
}

function vectorLiteral(v: number[]): string {
  if (v.length === 0 || !v.every(Number.isFinite)) throw new RangeError('embedding must be a non-empty vector of finite numbers');
  return `[${v.join(',')}]`;
}

const FRESH_MATCH = `c.content_md5 = md5(a.title || E'\\n' || a.content)`;

export class PgVectorStore implements VectorStore {
  constructor(private readonly db: RawSqlClient) {}

  async replaceArticleChunks(args: { tenantId: string; articleId: string; contentHash: string; model: string; dimensions: number; chunks: StoredChunkInput[] }): Promise<number> {
    for (const c of args.chunks) if (c.embedding.length !== args.dimensions) throw new RangeError(`chunk ${c.index} has ${c.embedding.length} dimensions, expected ${args.dimensions}`);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM ${PGVECTOR_TABLE} WHERE tenant_id = $1 AND article_id = $2 AND model = $3`, args.tenantId, args.articleId, args.model);
      let written = 0;
      for (const c of args.chunks) {
        written += await tx.$executeRawUnsafe(
          `INSERT INTO ${PGVECTOR_TABLE} (tenant_id, article_id, chunk_index, heading, text, content_md5, model, dims, embedding)
           SELECT a.tenant_id, a.id, $3::int, $4::text, $5::text, $6::text, $7::text, $8::int, $9::vector
           FROM knowledge_base_articles a
           WHERE a.id = $2 AND a.tenant_id = $1 AND md5(a.title || E'\\n' || a.content) = $6::text`,
          args.tenantId, args.articleId, c.index, c.heading, c.text, args.contentHash, args.model, args.dimensions, vectorLiteral(c.embedding),
        );
      }
      return written;
    });
  }

  async deleteArticleChunks(tenantId: string, articleId: string): Promise<void> {
    await this.db.$executeRawUnsafe(`DELETE FROM ${PGVECTOR_TABLE} WHERE tenant_id = $1 AND article_id = $2`, tenantId, articleId);
  }

  async search(tenantId: string, embedding: number[], options: VectorSearchOptions): Promise<VectorHit[]> {
    const rows = await this.db.$queryRawUnsafe<Array<{ tenant_id: string; article_id: string; chunk_index: number; heading: string | null; text: string; title: string; score: number }>>(
      `SELECT c.tenant_id, c.article_id, c.chunk_index, c.heading, c.text, a.title, (1 - (c.embedding <=> $2::vector))::float8 AS score
       FROM ${PGVECTOR_TABLE} c
       JOIN knowledge_base_articles a ON a.id = c.article_id AND a.tenant_id = c.tenant_id
       WHERE c.tenant_id = $1 AND a.tenant_id = $1 AND a.is_active = true
         AND c.model = $3 AND c.dims = $4::int AND ${FRESH_MATCH}
         AND (1 - (c.embedding <=> $2::vector)) >= $6::float8
       ORDER BY c.embedding <=> $2::vector
       LIMIT $5::int`,
      tenantId, vectorLiteral(embedding), options.model, options.dimensions, options.limit, options.minScore,
    );
    return rows.map((r) => ({ tenantId: r.tenant_id, articleId: r.article_id, chunkIndex: Number(r.chunk_index), heading: r.heading, text: r.text, title: r.title, score: Number(r.score) }));
  }

  async hasFreshIndex(tenantId: string, articleId: string, contentHash: string, model: string): Promise<boolean> {
    const rows = await this.db.$queryRawUnsafe<Array<{ n: number | bigint }>>(
      `SELECT count(*) AS n FROM ${PGVECTOR_TABLE} WHERE tenant_id = $1 AND article_id = $2 AND model = $3 AND content_md5 = $4`,
      tenantId, articleId, model, contentHash,
    );
    return Number(rows[0]?.n ?? 0) > 0;
  }

  async countChunks(tenantId: string, model: string): Promise<number> {
    const rows = await this.db.$queryRawUnsafe<Array<{ n: number | bigint }>>(`SELECT count(*) AS n FROM ${PGVECTOR_TABLE} WHERE tenant_id = $1 AND model = $2`, tenantId, model);
    return Number(rows[0]?.n ?? 0);
  }
}
