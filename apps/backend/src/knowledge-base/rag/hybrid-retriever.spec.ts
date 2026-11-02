import { selectRelevantArticles } from '../knowledge-base.util';
import { EmbeddingProvider } from './embedding-provider';
import { HybridConfig, HybridRetriever, readHybridConfig } from './hybrid-retriever';
import { KnowledgeIndexer } from './knowledge-indexer';
import { ConceptEmbedder } from './testing/concept-embedder';
import { FixtureArticle, FixtureDirectory, fixtureArticles } from './testing/fixture-kb';
import { InMemoryVectorStore, VectorHit, VectorStore } from './vector-store';

const TEST_CONFIG: Partial<HybridConfig> = { minVectorScore: 0.5, vectorTimeoutMs: 200 };
const CAPS = { maxArticles: 5, maxChars: 6000 };

async function setup(extra: FixtureArticle[] = [], config: Partial<HybridConfig> = {}) {
  const dir = new FixtureDirectory([...fixtureArticles('A', 'a'), ...fixtureArticles('B', 'b'), ...extra]);
  // Tenant B's parking article differs, so a leak of B into A (or the reverse) is detectable by content.
  dir.articles.find((a) => a.id === 'b2')!.content = 'B-ONLY-LOT: our car park is round the corner from the B branch.';
  const embedder = new ConceptEmbedder();
  const store = new InMemoryVectorStore(dir.record);
  const indexer = new KnowledgeIndexer({ loadActiveArticles: async (t) => dir.activeFor(t), embedder, store });
  for (const t of new Set(dir.articles.map((a) => a.tenantId))) await indexer.indexTenant(t);
  const warnings: string[] = [];
  const make = (overrides: { embedder?: EmbeddingProvider | null; store?: VectorStore | null; loadArticles?: (t: string) => Promise<FixtureArticle[]> } = {}) =>
    new HybridRetriever({
      loadArticles: overrides.loadArticles ?? (async (t) => dir.activeFor(t)),
      embedder: overrides.embedder === undefined ? embedder : overrides.embedder,
      store: overrides.store === undefined ? store : overrides.store,
      config: { ...TEST_CONFIG, ...config },
      warn: (m) => warnings.push(m),
    });
  const legacy = (tenantId: string, query: string, previous: string[] = []) =>
    selectRelevantArticles(dir.activeFor(tenantId), query, CAPS, previous).map((a) => ({ id: a.id, title: a.title, content: a.content }));
  const flat = (r: { articles: Array<{ id: string; title: string; content: string }> }) => r.articles.map((a) => ({ id: a.id, title: a.title, content: a.content }));
  return { dir, embedder, store, make, legacy, flat, warnings };
}

describe('HybridRetriever: paraphrased questions', () => {
  it('finds the parking article for a paraphrase that shares no word with it, where keyword retrieval finds nothing', async () => {
    const t = await setup();
    const query = 'Is there a spot for my vehicle?';
    expect(t.legacy('A', query)).toEqual([]);

    const result = await t.make().retrieve('A', query);

    expect(result.articles[0].id).toBe('a2');
    expect(result.trace.mode).toBe('hybrid');
    expect(result.trace.sources[0]).toMatchObject({ articleId: 'a2', via: ['vector'], vectorRank: 1, finalRank: 1 });
  });

  it('finds the refunds article for "can I get my money back"', async () => {
    const t = await setup();
    const result = await t.make().retrieve('A', 'Can I get my money back if I change my mind?');
    expect(result.articles.map((a) => a.id)).toContain('a10');
  });

  it('adds the delivery article that keyword retrieval misses for "bring a cake to my house"', async () => {
    const t = await setup();
    const query = 'Can someone bring a cake to my house?';
    expect(t.legacy('A', query).map((a) => a.id)).not.toContain('a7');

    const result = await t.make().retrieve('A', query);

    expect(result.articles.map((a) => a.id)).toContain('a7');
    expect(result.trace.sources.find((s) => s.articleId === 'a7')?.via).toContain('vector');
  });
});

describe('HybridRetriever: relevance and ranking', () => {
  it('ranks an article found by both retrievers first and records both ranks', async () => {
    const t = await setup();
    const result = await t.make().retrieve('A', 'Where can I leave my car?');
    expect(result.articles[0].id).toBe('a2');
    expect(result.trace.sources[0].via).toEqual(['keyword', 'vector']);
    expect(result.trace.sources[0].keywordRank).toBe(1);
    expect(result.trace.sources[0].vectorRank).toBe(1);
  });

  it('respects the article and character caps', async () => {
    const t = await setup();
    const few = await t.make().retrieve('A', 'Can someone bring a cake to my house?');
    expect(few.articles.length).toBeLessThanOrEqual(5);
    const tiny = await (await setup([], { maxChars: 300 })).make().retrieve('A', 'Can someone bring a cake to my house?');
    expect(tiny.articles.reduce((n, a) => n + a.title.length + a.content.length, 0)).toBeLessThanOrEqual(300 + tiny.articles[0].content.length);
    expect(tiny.articles.length).toBeLessThan(few.articles.length);
  });

  it('passes only the matching chunks of a long article, with their chunk numbers in the trace', async () => {
    const long: FixtureArticle = {
      id: 'c-long', tenantId: 'A', isActive: true, title: 'Everything about the shop',
      content: [
        `# Trading\n${'We bake fresh bread every morning and sell it until it runs out. '.repeat(14)}`,
        `# Getting here\nThe vehicle spaces are behind the building. ${'Please drive slowly in the yard and watch for pedestrians. '.repeat(14)}`,
        `# Contact\n${'Write to us any time and we will reply the next working day. '.repeat(14)}`,
      ].join('\n\n'),
    };
    const t = await setup([long]);
    const result = await t.make().retrieve('A', 'Is there a spot for my vehicle?');
    const picked = result.articles.find((a) => a.id === 'c-long');
    expect(picked).toBeDefined();
    expect(picked!.content.length).toBeLessThan(long.content.length);
    expect(picked!.content).toContain('vehicle spaces');
    expect(result.trace.sources.find((s) => s.articleId === 'c-long')?.chunkIndexes.length).toBeGreaterThan(0);
  });

  it('embeds a thin follow-up together with the customer\'s previous message', async () => {
    const t = await setup();
    const spy = jest.spyOn(t.embedder, 'embed');
    await t.make().retrieve('A', 'and on Saturdays?', ['Is there parking for my vehicle?']);
    const embeddedText = (spy.mock.calls[0][0] as string[])[0];
    expect(embeddedText).toContain('parking');
    expect(embeddedText).toContain('Saturdays');
  });
});

describe('HybridRetriever: missing knowledge', () => {
  it.each(['What is the capital of France?', 'Tell me a joke about penguins'])('returns nothing for %j rather than the nearest unrelated article', async (query) => {
    const t = await setup();
    const result = await t.make().retrieve('A', query);
    expect(result.articles).toEqual([]);
    expect(result.trace.mode).toBe('keyword');
    expect(result.trace.fallbackReason).toBe('no_vector_hits');
  });

  it('does not call the embedding provider for a greeting or a thank-you', async () => {
    const t = await setup();
    const before = t.embedder.calls.length;
    const result = await t.make().retrieve('A', 'ok thanks');
    expect(result.articles).toEqual([]);
    expect(t.embedder.calls.length).toBe(before);
  });

  it('returns nothing for a tenant with no articles', async () => {
    const t = await setup();
    expect((await t.make().retrieve('Z', 'Is there a spot for my vehicle?')).articles).toEqual([]);
  });

  it('stops returning an article once it is deactivated, or edited and not yet re-indexed', async () => {
    const t = await setup();
    t.dir.articles.find((a) => a.id === 'a2')!.content = 'We have moved; ask at the counter.';
    const edited = await t.make().retrieve('A', 'Is there a spot for my vehicle?');
    expect(edited.articles.map((a) => a.id)).not.toContain('a2');

    const t2 = await setup();
    t2.dir.articles.find((a) => a.id === 'a2')!.isActive = false;
    expect((await t2.make().retrieve('A', 'Is there a spot for my vehicle?')).articles.map((a) => a.id)).not.toContain('a2');
  });
});

describe('HybridRetriever: tenant isolation', () => {
  it('returns only the asking tenant\'s articles and never another tenant\'s content', async () => {
    const t = await setup();
    const asA = await t.make().retrieve('A', 'Where can I leave my car?');
    expect(asA.articles.every((a) => a.id.startsWith('a'))).toBe(true);
    expect(JSON.stringify(asA)).not.toContain('B-ONLY-LOT');

    const asB = await t.make().retrieve('B', 'Where can I leave my car?');
    expect(asB.articles.every((a) => a.id.startsWith('b'))).toBe(true);
    expect(asB.articles[0].content).toContain('B-ONLY-LOT');
  });

  it('asks the vector store for the requesting tenant only', async () => {
    const t = await setup();
    const spy = jest.spyOn(t.store, 'search');
    await t.make().retrieve('A', 'Is there a spot for my vehicle?');
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['A']);
  });

  it('drops a vector hit that belongs to another tenant, even if the store returns it', async () => {
    const t = await setup();
    const leaky = Object.assign(Object.create(t.store), {
      search: async (): Promise<VectorHit[]> => [{ tenantId: 'B', articleId: 'b2', chunkIndex: 0, heading: null, text: 'B-ONLY-LOT', title: 'Location and parking', score: 0.99 }],
    }) as VectorStore;
    const result = await t.make({ store: leaky }).retrieve('A', 'Is there a spot for my vehicle?');
    expect(JSON.stringify(result)).not.toContain('B-ONLY-LOT');
    expect(result.articles).toEqual([]);
    expect(t.warnings.some((w) => w.includes('does not belong'))).toBe(true);
  });

  it('drops a hit whose article is not in the tenant\'s active list, whatever tenant it claims', async () => {
    const t = await setup();
    const forged = Object.assign(Object.create(t.store), {
      search: async (): Promise<VectorHit[]> => [{ tenantId: 'A', articleId: 'b2', chunkIndex: 0, heading: null, text: 'B-ONLY-LOT', title: 'x', score: 0.99 }],
    }) as VectorStore;
    expect((await t.make({ store: forged }).retrieve('A', 'Is there a spot for my vehicle?')).articles).toEqual([]);
  });
});

describe('HybridRetriever: fallback to keyword retrieval', () => {
  const QUERY = 'How much is a flat white and an almond croissant?';

  it.each([
    ['no embedding provider', { embedder: null }, 'no_embedding_provider', 'keyword'],
    ['no vector store', { store: null }, 'no_vector_store', 'keyword'],
  ] as const)('is exactly the keyword result with %s', async (_name, overrides, reason, mode) => {
    const t = await setup();
    const result = await t.make(overrides as never).retrieve('A', QUERY);
    expect(t.flat(result)).toEqual(t.legacy('A', QUERY));
    expect(result.trace).toMatchObject({ mode, fallbackReason: reason });
  });

  it('is exactly the keyword result when the embedding provider throws', async () => {
    const t = await setup();
    const broken: EmbeddingProvider = { id: 'x', model: 'x', dimensions: 4, embed: async () => { throw new Error('provider down'); } };
    const result = await t.make({ embedder: broken }).retrieve('A', QUERY);
    expect(t.flat(result)).toEqual(t.legacy('A', QUERY));
    expect(result.trace).toMatchObject({ mode: 'keyword-fallback', fallbackReason: 'vector_error' });
  });

  it('is exactly the keyword result when the vector store throws', async () => {
    const t = await setup();
    const broken = Object.assign(Object.create(t.store), { search: async () => { throw new Error('db down'); } }) as VectorStore;
    const result = await t.make({ store: broken }).retrieve('A', QUERY);
    expect(t.flat(result)).toEqual(t.legacy('A', QUERY));
    expect(result.trace.fallbackReason).toBe('vector_error');
  });

  it('is exactly the keyword result when the provider returns a vector of the wrong size', async () => {
    const t = await setup();
    const wrong: EmbeddingProvider = { id: 'x', model: 'x', dimensions: 4, embed: async () => [[1, 0]] };
    const result = await t.make({ embedder: wrong }).retrieve('A', QUERY);
    expect(t.flat(result)).toEqual(t.legacy('A', QUERY));
    expect(result.trace.fallbackReason).toBe('vector_error');
  });

  it('gives up on a slow vector side after the timeout and returns the keyword result', async () => {
    const t = await setup();
    const slow: EmbeddingProvider = { id: 'x', model: 'x', dimensions: 4, embed: () => new Promise(() => undefined) };
    const started = Date.now();
    const result = await (await setup([], { vectorTimeoutMs: 60 })).make({ embedder: slow }).retrieve('A', QUERY);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(t.flat(result)).toEqual(t.legacy('A', QUERY));
    expect(result.trace.fallbackReason).toBe('vector_timeout');
  });

  it('is exactly the keyword result when the tenant has no index yet', async () => {
    const t = await setup([...fixtureArticles('C', 'c')]);
    const empty = new InMemoryVectorStore(t.dir.record);
    const result = await t.make({ store: empty }).retrieve('C', QUERY);
    expect(t.flat(result)).toEqual(t.legacy('C', QUERY));
    expect(result.trace.fallbackReason).toBe('no_vector_hits');
  });

  it('leaves a small knowledge base untouched: all of it, with no embedding call', async () => {
    const small = fixtureArticles('S', 's').slice(0, 4);
    const t = await setup(small);
    const before = t.embedder.calls.length;
    const result = await t.make().retrieve('S', 'Is there a spot for my vehicle?');
    expect(result.articles).toHaveLength(4);
    expect(t.embedder.calls.length).toBe(before);
  });

  it('a failure while loading articles propagates, so the caller can use its own keyword path', async () => {
    const t = await setup();
    await expect(t.make({ loadArticles: async () => { throw new Error('db down'); } }).retrieve('A', QUERY)).rejects.toThrow('db down');
  });
});

describe('readHybridConfig', () => {
  it('reads valid overrides and ignores invalid ones', () => {
    expect(readHybridConfig({ RAG_RRF_K: '30', RAG_MIN_VECTOR_SCORE: '0.5', RAG_VECTOR_TIMEOUT_MS: 'abc', RAG_VECTOR_WEIGHT: '-2' })).toMatchObject({ rrfK: 30, minVectorScore: 0.5, vectorTimeoutMs: 800, vectorWeight: 1 });
  });
});
