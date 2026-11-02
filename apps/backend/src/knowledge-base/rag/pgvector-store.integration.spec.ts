import { PrismaClient } from '@prisma/client';
import { normalizeVector } from './embedding-provider';
import { ensurePgVectorSchema, isPgVectorReady, PgVectorStore, PGVECTOR_TABLE, RawSqlClient } from './pgvector-store';
import { contentHashOf } from './vector-store';

/**
 * Runs the real SQL against a real PostgreSQL that has the pgvector extension and the application's tables. It is skipped unless
 * RAG_TEST_DATABASE_URL points at an ISOLATED test database (never staging or production): the suite creates its own tenants and
 * articles and removes them afterwards. In CI and on a normal `jest` run, where the variable is unset, it does nothing.
 */
const url = process.env['RAG_TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('PgVectorStore against PostgreSQL + pgvector', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://unused' } } });
  const db = prisma as unknown as RawSqlClient;
  const store = new PgVectorStore(db);
  const v = (...xs: number[]) => normalizeVector(xs);
  const OPTIONS = { model: 'm1', dimensions: 3, limit: 10, minScore: 0.5 };
  const TENANTS = ['rag-test-A', 'rag-test-B'];
  const articles: Record<string, { tenant: string; title: string; content: string }> = {
    'rag-a1': { tenant: 'rag-test-A', title: 'Location and parking', content: 'Six free parking spaces behind the shop.' },
    'rag-a2': { tenant: 'rag-test-A', title: 'Opening hours', content: 'Open Monday to Friday from seven to six.' },
    'rag-b1': { tenant: 'rag-test-B', title: 'Location and parking', content: 'B-ONLY-LOT round the corner.' },
  };
  const hashOf = (id: string) => contentHashOf(articles[id].title, articles[id].content);
  const put = (id: string, embedding: number[], over: Partial<{ tenantId: string; model: string; dimensions: number; contentHash: string }> = {}) =>
    store.replaceArticleChunks({ tenantId: articles[id].tenant, articleId: id, contentHash: hashOf(id), model: 'm1', dimensions: 3, chunks: [{ index: 0, heading: null, text: articles[id].content, embedding }], ...over });

  async function clean() {
    await prisma.$executeRawUnsafe(`DELETE FROM knowledge_base_articles WHERE tenant_id = ANY($1::text[])`, TENANTS);
    await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1::text[])`, TENANTS);
  }

  beforeAll(async () => {
    await ensurePgVectorSchema(db);
    await clean();
    for (const t of TENANTS) await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, updated_at) VALUES ($1, $1, $1, now())`, t);
    for (const [id, a] of Object.entries(articles)) {
      await prisma.$executeRawUnsafe(`INSERT INTO knowledge_base_articles (id, tenant_id, title, content, updated_at) VALUES ($1, $2, $3, $4, now())`, id, a.tenant, a.title, a.content);
    }
  });
  afterAll(async () => { await clean(); await prisma.$disconnect(); });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM ${PGVECTOR_TABLE} WHERE tenant_id = ANY($1::text[])`, TENANTS);
    for (const [id, a] of Object.entries(articles)) await prisma.$executeRawUnsafe(`UPDATE knowledge_base_articles SET title = $2, content = $3, is_active = true WHERE id = $1`, id, a.title, a.content);
  });

  it('reports the extension and table as ready after the schema is applied (and the schema step is repeatable)', async () => {
    await ensurePgVectorSchema(db);
    expect(await isPgVectorReady(db)).toBe(true);
  });

  it('stores a chunk for the tenant\'s own article and finds it by similarity', async () => {
    expect(await put('rag-a1', v(1, 0, 0))).toBe(1);
    const hits = await store.search('rag-test-A', v(1, 0, 0), OPTIONS);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ tenantId: 'rag-test-A', articleId: 'rag-a1', chunkIndex: 0, title: 'Location and parking' });
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it('never returns another tenant\'s chunk, even when its vector is identical', async () => {
    await put('rag-a1', v(1, 0, 0));
    await put('rag-b1', v(1, 0, 0));
    expect((await store.search('rag-test-A', v(1, 0, 0), OPTIONS)).map((h) => h.articleId)).toEqual(['rag-a1']);
    expect((await store.search('rag-test-B', v(1, 0, 0), OPTIONS)).map((h) => h.articleId)).toEqual(['rag-b1']);
    expect(await store.search('rag-test-C', v(1, 0, 0), OPTIONS)).toEqual([]);
  });

  it('refuses to store a chunk for an article the tenant does not own', async () => {
    expect(await put('rag-b1', v(1, 0, 0), { tenantId: 'rag-test-A' })).toBe(0);
    expect(await store.countChunks('rag-test-A', 'm1')).toBe(0);
    expect(await store.countChunks('rag-test-B', 'm1')).toBe(0);
  });

  it('refuses to store vectors for content that changed after it was read', async () => {
    expect(await put('rag-a1', v(1, 0, 0), { contentHash: contentHashOf('Location and parking', 'an older version of the text') })).toBe(0);
  });

  it('ignores the vectors of an edited article until it is re-indexed', async () => {
    await put('rag-a1', v(1, 0, 0));
    await prisma.$executeRawUnsafe(`UPDATE knowledge_base_articles SET content = 'We have moved.' WHERE id = 'rag-a1'`);
    expect(await store.search('rag-test-A', v(1, 0, 0), OPTIONS)).toEqual([]);
    expect(await store.hasFreshIndex('rag-test-A', 'rag-a1', hashOf('rag-a1'), 'm1')).toBe(true); // the old row is still there, just not searched
    await prisma.$executeRawUnsafe(`UPDATE knowledge_base_articles SET content = $1 WHERE id = 'rag-a1'`, articles['rag-a1'].content);
    expect(await store.search('rag-test-A', v(1, 0, 0), OPTIONS)).toHaveLength(1);
  });

  it('skips a deactivated article', async () => {
    await put('rag-a1', v(1, 0, 0));
    await prisma.$executeRawUnsafe(`UPDATE knowledge_base_articles SET is_active = false WHERE id = 'rag-a1'`);
    expect(await store.search('rag-test-A', v(1, 0, 0), OPTIONS)).toEqual([]);
  });

  it('never compares vectors of a different model or dimension count', async () => {
    await put('rag-a1', v(1, 0, 0));
    expect(await store.search('rag-test-A', v(1, 0, 0), { ...OPTIONS, model: 'other' })).toEqual([]);
    expect(await store.search('rag-test-A', v(1, 0), { ...OPTIONS, dimensions: 2 })).toEqual([]);
  });

  it('orders by cosine similarity, applies the minimum score and the limit', async () => {
    await put('rag-a1', v(1, 0, 0));
    await put('rag-a2', v(1, 1, 0));
    const both = await store.search('rag-test-A', v(1, 0, 0), OPTIONS);
    expect(both.map((h) => h.articleId)).toEqual(['rag-a1', 'rag-a2']);
    expect(both[0].score).toBeGreaterThan(both[1].score);
    expect((await store.search('rag-test-A', v(1, 0, 0), { ...OPTIONS, minScore: 0.9 })).map((h) => h.articleId)).toEqual(['rag-a1']);
    expect(await store.search('rag-test-A', v(1, 0, 0), { ...OPTIONS, limit: 1 })).toHaveLength(1);
  });

  it('replaces an article\'s chunks rather than adding to them', async () => {
    await put('rag-a1', v(1, 0, 0));
    await put('rag-a1', v(0, 1, 0));
    expect(await store.countChunks('rag-test-A', 'm1')).toBe(1);
    expect(await store.search('rag-test-A', v(1, 0, 0), OPTIONS)).toEqual([]);
  });

  it('removes an article\'s chunks when the article or the tenant is deleted', async () => {
    await put('rag-a1', v(1, 0, 0));
    await put('rag-a2', v(0, 1, 0));
    await prisma.$executeRawUnsafe(`DELETE FROM knowledge_base_articles WHERE id = 'rag-a1'`);
    expect(await store.countChunks('rag-test-A', 'm1')).toBe(1);
    await store.deleteArticleChunks('rag-test-A', 'rag-a2');
    expect(await store.countChunks('rag-test-A', 'm1')).toBe(0);
    await prisma.$executeRawUnsafe(`INSERT INTO knowledge_base_articles (id, tenant_id, title, content, updated_at) VALUES ('rag-a1', 'rag-test-A', $1, $2, now())`, articles['rag-a1'].title, articles['rag-a1'].content);
  });

  it('rejects a vector of the wrong size before writing anything', async () => {
    await expect(put('rag-a1', v(1, 0))).rejects.toThrow(RangeError);
    expect(await store.countChunks('rag-test-A', 'm1')).toBe(0);
  });

  it('treats a hostile tenant id as data: no rows, no error, nothing dropped', async () => {
    await put('rag-a1', v(1, 0, 0));
    expect(await store.search("rag-test-A' OR '1'='1", v(1, 0, 0), OPTIONS)).toEqual([]);
    expect(await store.search("x'; DROP TABLE kb_vector_chunks; --", v(1, 0, 0), OPTIONS)).toEqual([]);
    expect(await store.countChunks('rag-test-A', 'm1')).toBe(1);
  });
});
