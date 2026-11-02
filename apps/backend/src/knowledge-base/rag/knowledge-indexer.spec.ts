import { EmbeddingProvider, EmbeddingUnavailableError } from './embedding-provider';
import { embeddingTextOf, KnowledgeIndexer } from './knowledge-indexer';
import { ConceptEmbedder } from './testing/concept-embedder';
import { FixtureArticle, FixtureDirectory, fixtureArticles } from './testing/fixture-kb';
import { InMemoryVectorStore } from './vector-store';

function setup(extra: FixtureArticle[] = [], chunkOptions = {}, batchSize?: number) {
  const dir = new FixtureDirectory([...fixtureArticles('A', 'a'), ...fixtureArticles('B', 'b'), ...extra]);
  const embedder = new ConceptEmbedder();
  const store = new InMemoryVectorStore(dir.record);
  const loader = jest.fn(async (t: string) => dir.activeFor(t));
  const indexer = new KnowledgeIndexer({ loadActiveArticles: loader, embedder, store, chunkOptions, batchSize });
  return { dir, embedder, store, loader, indexer };
}

describe('KnowledgeIndexer', () => {
  it('indexes one tenant only, and never touches another tenant\'s rows or articles', async () => {
    const t = setup();
    const report = await t.indexer.indexTenant('A');
    expect(report).toMatchObject({ tenantId: 'A', articles: 12, chunks: 12, embeddedChunks: 12, rowsWritten: 12, alreadyFresh: 0 });
    expect(t.loader).toHaveBeenCalledTimes(1);
    expect(t.loader).toHaveBeenCalledWith('A');
    expect(await t.store.countChunks('A', t.embedder.model)).toBe(12);
    expect(await t.store.countChunks('B', t.embedder.model)).toBe(0);
  });

  it('skips articles whose content has not changed, and re-embeds only the one that did', async () => {
    const t = setup();
    await t.indexer.indexTenant('A');
    const again = await t.indexer.indexTenant('A');
    expect(again).toMatchObject({ alreadyFresh: 12, embeddedChunks: 0, rowsWritten: 0 });

    t.dir.articles.find((a) => a.id === 'a3')!.content = 'We now also bake focaccia every day.';
    const afterEdit = await t.indexer.indexTenant('A');
    expect(afterEdit).toMatchObject({ alreadyFresh: 11, embeddedChunks: 1, rowsWritten: 1 });
  });

  it('can be forced to rebuild everything', async () => {
    const t = setup();
    await t.indexer.indexTenant('A');
    expect(await t.indexer.indexTenant('A', { force: true })).toMatchObject({ alreadyFresh: 0, embeddedChunks: 12 });
  });

  it('a dry run reports chunks and an estimated token count without calling the provider or writing anything', async () => {
    const dir = new FixtureDirectory(fixtureArticles('A', 'a'));
    const embed = jest.fn();
    const indexer = new KnowledgeIndexer({ loadActiveArticles: async (t) => dir.activeFor(t), embedder: null, store: null });
    const report = await indexer.indexTenant('A', { dryRun: true });
    expect(report).toMatchObject({ dryRun: true, articles: 12, chunks: 12, embeddedChunks: 0, rowsWritten: 0 });
    expect(report.estimatedTokens).toBeGreaterThan(100);
    expect(embed).not.toHaveBeenCalled();
  });

  it('refuses a real run without a provider and a store', async () => {
    const dir = new FixtureDirectory(fixtureArticles('A', 'a'));
    const indexer = new KnowledgeIndexer({ loadActiveArticles: async (t) => dir.activeFor(t), embedder: null, store: null });
    await expect(indexer.indexTenant('A')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it('splits a long article into several chunks and embeds them in batches of the configured size', async () => {
    const long: FixtureArticle = { id: 'long', tenantId: 'A', isActive: true, title: 'Long', content: Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says something useful about the bakery.`).join(' ') };
    const t = setup([long], { targetChars: 300, maxChars: 500, overlapChars: 50 }, 2);
    const report = await t.indexer.indexTenant('A');
    expect(report.chunks).toBeGreaterThan(12 + 3);
    expect(t.embedder.calls.every((c) => c.count <= 2)).toBe(true);
    expect(t.embedder.calls.every((c) => c.kind === 'document')).toBe(true);
  });

  it('embeds the title and heading together with the chunk text', () => {
    expect(embeddingTextOf('Delivery', { index: 0, heading: 'Fees', text: 'It costs $4.' })).toBe('Delivery\nFees\nIt costs $4.');
    expect(embeddingTextOf('Delivery', { index: 0, heading: null, text: 'It costs $4.' })).toBe('Delivery\nIt costs $4.');
  });

  it('fails loudly if the provider returns the wrong number of vectors', async () => {
    const long: FixtureArticle = { id: 'long', tenantId: 'A', isActive: true, title: 'Long', content: Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says something useful about the bakery.`).join(' ') };
    const dir = new FixtureDirectory([long]);
    const bad: EmbeddingProvider = { id: 'x', model: 'x', dimensions: 3, embed: async () => [[1, 0, 0]] };
    const indexer = new KnowledgeIndexer({ loadActiveArticles: async (t) => dir.activeFor(t), embedder: bad, store: new InMemoryVectorStore(dir.record), chunkOptions: { targetChars: 300, maxChars: 500, overlapChars: 50 }, batchSize: 8 });
    await expect(indexer.indexTenant('A')).rejects.toThrow(/wrong number of vectors/);
  });
});
