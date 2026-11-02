import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { selectRelevantArticles } from '../../knowledge-base.util';
import { cosineSimilarity, EmbeddingUnavailableError } from '../embedding-provider';
import { HybridRetriever } from '../hybrid-retriever';
import { KnowledgeIndexer } from '../knowledge-indexer';
import { ensurePgVectorSchema, PGVECTOR_TABLE, PgVectorStore, RawSqlClient } from '../pgvector-store';
import { fixtureArticles } from '../testing/fixture-kb';
import { contentHashOf } from '../vector-store';
import { createLocalMiniLmProvider } from './minilm-loader';

/**
 * Runs the REAL all-MiniLM-L6-v2 model (WebAssembly) end to end. Skipped unless EMBEDDING_MODEL_DIR points at the pinned model files and
 * onnxruntime-web can be resolved (e.g. NODE_PATH=<dir>/node_modules). The retrieval half also needs RAG_TEST_DATABASE_URL, an ISOLATED
 * PostgreSQL with pgvector and the application's tables; it creates and removes its own tenants.
 */
const modelDir = process.env['EMBEDDING_MODEL_DIR'];
const dbUrl = process.env['RAG_TEST_DATABASE_URL'];
const ortAvailable = (() => { try { require.resolve('onnxruntime-web'); return true; } catch { return false; } })();
const modelSuite = modelDir && ortAvailable ? describe : describe.skip;
const dbSuite = modelDir && ortAvailable && dbUrl ? describe : describe.skip;

const provider = () => createLocalMiniLmProvider({ EMBEDDING_MODEL_DIR: modelDir });

modelSuite('LocalMiniLmEmbeddingProvider with the real model', () => {
  const p = provider();
  const reference = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'embedding-reference.json'), 'utf8')) as Array<{ text: string; vector: number[] }>;

  const wasmReference = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'embedding-reference-wasm.json'), 'utf8')) as Array<{ text: string; vector: number[] }>;

  it('matches an independent WebAssembly pipeline (transformers.js tokenizer, hand-written pooling) to 0.9999 cosine', async () => {
    const vectors = await p.embed(wasmReference.map((r) => r.text), 'document');
    wasmReference.forEach((r, i) => expect(cosineSimilarity(vectors[i], r.vector)).toBeGreaterThan(0.9999));
  });

  // Same weights, but the native CPU kernels quantise activations differently from the WebAssembly ones: measured 0.994-0.996 on real text
  // (0.984 for the empty string) with token ids identical. That is the int8 model's cross-runtime noise, not a pooling or tokenizer error.
  it('agrees with native ONNX Runtime (Python tokenizers + onnxruntime 1.31.1) to within int8 noise', async () => {
    const vectors = await p.embed(reference.map((r) => r.text), 'document');
    reference.forEach((r, i) => {
      expect(vectors[i]).toHaveLength(384);
      expect(cosineSimilarity(vectors[i], r.vector)).toBeGreaterThan(r.text === '' ? 0.97 : 0.99);
    });
  });

  it('gives the identical vector for a text alone or inside a list, and as a query or a document', async () => {
    const alone = (await p.embed(['Where can I leave my car?'], 'query'))[0];
    const inList = (await p.embed(['A much longer text that would force padding if texts were batched together, with many more words in it', 'Where can I leave my car?'], 'document'))[1];
    expect(cosineSimilarity(alone, inList)).toBeGreaterThan(0.99999);
  });

  it('puts a paraphrase closer than an unrelated sentence', async () => {
    const [question, paraphrase, unrelated] = await p.embed(['Is there somewhere to park?', 'There are six free car spaces behind the shop.', 'We bake sourdough every morning.'], 'query');
    expect(cosineSimilarity(question, paraphrase)).toBeGreaterThan(cosineSimilarity(question, unrelated));
  });

  it('measures memory and latency (logged, with generous bounds so slow CI hosts do not flake)', async () => {
    const warm = provider();
    const t0 = Date.now();
    await warm.warmUp!();
    const loadMs = Date.now() - t0;
    const times: number[] = [];
    for (let i = 0; i < 20; i++) { const t = performance.now(); await warm.embed(['What are your opening hours on weekdays?'], 'query'); times.push(performance.now() - t); }
    times.sort((a, b) => a - b);
    const mem = process.memoryUsage();
    console.log(`MiniLM load ${loadMs} ms; query p50 ${times[10].toFixed(1)} ms p95 ${times[18].toFixed(1)} ms; rss ${Math.round(mem.rss / 1048576)} MB, heap ${Math.round(mem.heapUsed / 1048576)} MB, external ${Math.round(mem.external / 1048576)} MB`);
    expect(times[10]).toBeLessThan(500);
  });

  it('refuses to run on a model directory with the wrong files, so retrieval would fall back', async () => {
    const wrong = createLocalMiniLmProvider({ EMBEDDING_MODEL_DIR: path.join(__dirname, 'fixtures') });
    await expect(wrong.embed(['hello'], 'query')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });
});

dbSuite('real MiniLM through KnowledgeIndexer, PgVectorStore and HybridRetriever (isolated database)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl ?? 'postgresql://unused' } } });
  const db = prisma as unknown as RawSqlClient;
  const store = new PgVectorStore(db);
  const embedder = provider();
  const TENANTS = ['minilm-test-A', 'minilm-test-B'];
  const [A, B] = TENANTS;
  const kbA = fixtureArticles(A, 'ma');
  const kbB = fixtureArticles(B, 'mb').map((a) => ({ ...a, content: a.content.replace(/parking/gi, 'B-ONLY-LOT') }));
  const config = { minVectorScore: embedder.recommendedMinVectorScore, vectorTimeoutMs: 5000 };
  const ids = (r: { articles: Array<{ id: string }> }) => r.articles.map((a) => a.id);

  async function clean() {
    await prisma.$executeRawUnsafe(`DELETE FROM knowledge_base_articles WHERE tenant_id = ANY($1::text[])`, TENANTS);
    await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1::text[])`, TENANTS);
  }
  const seed = async (tenant: string, kb: typeof kbA) => {
    await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, updated_at) VALUES ($1, $1, $1, now())`, tenant);
    for (const a of kb) await prisma.$executeRawUnsafe(`INSERT INTO knowledge_base_articles (id, tenant_id, title, content, updated_at) VALUES ($1, $2, $3, $4, now())`, a.id, tenant, a.title, a.content);
  };
  const indexer = (tenantKb: Record<string, typeof kbA>) => new KnowledgeIndexer({ loadActiveArticles: async (t) => tenantKb[t] ?? [], embedder, store });
  const retriever = (tenantKb: Record<string, typeof kbA>, over: Partial<ConstructorParameters<typeof HybridRetriever>[0]> = {}) =>
    new HybridRetriever({ loadArticles: async (t) => tenantKb[t] ?? [], embedder, store, config, ...over });

  beforeAll(async () => {
    await ensurePgVectorSchema(db);
    await clean();
    await seed(A, kbA);
    await seed(B, kbB);
    await indexer({ [A]: kbA, [B]: kbB }).indexTenant(A);
    await indexer({ [A]: kbA, [B]: kbB }).indexTenant(B);
  }, 120_000);
  afterAll(async () => { await prisma.$executeRawUnsafe(`DELETE FROM ${PGVECTOR_TABLE} WHERE tenant_id = ANY($1::text[])`, TENANTS); await clean(); await prisma.$disconnect(); });

  const byTitle = (kb: typeof kbA, title: string) => kb.find((a) => a.title === title)!.id;

  it('indexed only on request: both tenants have chunks stored under the model identity', async () => {
    expect(await store.countChunks(A, embedder.model)).toBeGreaterThanOrEqual(kbA.length);
    expect(await store.countChunks(B, embedder.model)).toBeGreaterThanOrEqual(kbB.length);
  });

  // Phrasings that share no useful word with the article, chosen from queries MiniLM handles; its known misses (for example "do you bring
  // a cake to my house" against the delivery article, cosine 0.13) are documented in docs/VERZAI_V2_HYBRID_RAG.md rather than hidden here.
  it.each([
    ['can I get my money back', 'Cancellations and refunds'],
    ['can I get my money back if I change my mind', 'Cancellations and refunds'],
    ['anything without animal products?', 'Allergens and dietary options'],
  ])('finds the right article for the paraphrase %j, which keyword retrieval alone misses', async (query, title) => {
    const want = byTitle(kbA, title);
    expect(ids({ articles: selectRelevantArticles(kbA, query, { maxArticles: 5, maxChars: 6000 }, []) })).not.toContain(want);
    const result = await retriever({ [A]: kbA }).retrieve(A, query);
    expect(result.trace.mode).toBe('hybrid');
    expect(ids(result)).toContain(want);
    expect(result.trace.sources.find((s) => s.articleId === want)?.via).toContain('vector');
  });

  it('keeps tenant isolation with real vectors: tenant B never sees tenant A articles, and A never sees B\'s', async () => {
    const q = 'Where can I leave my car when I come to the shop?';
    const forB = await retriever({ [A]: kbA, [B]: kbB }).retrieve(B, q);
    expect(ids(forB).every((id) => id.startsWith('mb'))).toBe(true);
    const forA = await retriever({ [A]: kbA, [B]: kbB }).retrieve(A, q);
    expect(ids(forA).every((id) => id.startsWith('ma'))).toBe(true);
    expect(forA.articles.map((a) => a.content).join(' ')).not.toContain('B-ONLY-LOT');
    expect(await retriever({}).retrieve('minilm-test-C', q).then(ids)).toEqual([]);
  });

  it('applies the existing article and character limits', async () => {
    const result = await retriever({ [A]: kbA }, { config: { ...config, maxArticles: 2, maxChars: 400 } }).retrieve(A, 'opening hours cakes delivery parking refunds');
    expect(result.articles.length).toBeLessThanOrEqual(2);
    expect(result.articles.reduce((n, a) => n + a.content.length, 0)).toBeLessThanOrEqual(400);
  });

  it('answers exactly like keyword retrieval when the model cannot run (wrong directory)', async () => {
    const broken = createLocalMiniLmProvider({ EMBEDDING_MODEL_DIR: '/does/not/exist' });
    const q = 'Where can I leave my car when I come to the shop?';
    const result = await retriever({ [A]: kbA }, { embedder: broken }).retrieve(A, q);
    expect(result.trace).toMatchObject({ mode: 'keyword-fallback', fallbackReason: 'vector_error' });
    expect(ids(result)).toEqual(selectRelevantArticles(kbA, q, { maxArticles: 5, maxChars: 6000 }, []).map((a) => a.id));
  });

  it('answers exactly like keyword retrieval when the model is too slow (timeout)', async () => {
    const q = 'Where can I leave my car when I come to the shop?';
    const result = await retriever({ [A]: kbA }, { config: { ...config, vectorTimeoutMs: 50 }, embedder: { ...embedder, id: embedder.id, model: embedder.model, dimensions: embedder.dimensions, embed: () => new Promise(() => undefined) } }).retrieve(A, q);
    expect(result.trace).toMatchObject({ mode: 'keyword-fallback', fallbackReason: 'vector_timeout' });
    expect(ids(result)).toEqual(selectRelevantArticles(kbA, q, { maxArticles: 5, maxChars: 6000 }, []).map((a) => a.id));
  });

  it('stops using the stored vector of an article edited after indexing, until it is re-indexed explicitly (keyword retrieval still sees the new text)', async () => {
    const refunds = byTitle(kbA, 'Cancellations and refunds');
    const before = await retriever({ [A]: kbA }).retrieve(A, 'can I get my money back');
    expect(before.trace.sources.find((s) => s.articleId === refunds)?.via).toContain('vector');
    await prisma.$executeRawUnsafe(`UPDATE knowledge_base_articles SET content = content || ' Updated.' WHERE id = $1`, refunds);
    const edited = kbA.map((a) => (a.id === refunds ? { ...a, content: `${a.content} Updated.` } : a));
    const after = await retriever({ [A]: edited }).retrieve(A, 'can I get my money back');
    expect(after.trace.sources.find((s) => s.articleId === refunds)?.via ?? []).not.toContain('vector');
    expect(await store.hasFreshIndex(A, refunds, contentHashOf('Cancellations and refunds', edited.find((a) => a.id === refunds)!.content), embedder.model)).toBe(false);
  });
});
