import { normalizeVector } from './embedding-provider';
import { FixtureDirectory, fixtureArticles } from './testing/fixture-kb';
import { contentHashOf, InMemoryVectorStore } from './vector-store';

const v = (...xs: number[]) => normalizeVector(xs);
const OPTIONS = { model: 'm1', dimensions: 3, limit: 10, minScore: 0.5 };

function setup() {
  const dir = new FixtureDirectory([...fixtureArticles('A', 'a'), ...fixtureArticles('B', 'b')]);
  const store = new InMemoryVectorStore(dir.record);
  const put = (tenantId: string, articleId: string, embedding: number[], model = 'm1', dimensions = 3) => {
    const a = dir.articles.find((x) => x.tenantId === tenantId && x.id === articleId)!;
    return store.replaceArticleChunks({ tenantId, articleId, contentHash: contentHashOf(a.title, a.content), model, dimensions, chunks: [{ index: 0, heading: null, text: a.content, embedding }] });
  };
  return { dir, store, put };
}

describe('InMemoryVectorStore (the reference behaviour the SQL store must match)', () => {
  it('searches only the requested tenant, even when another tenant holds an identical vector', async () => {
    const { store, put } = setup();
    await put('A', 'a1', v(1, 0, 0));
    await put('B', 'b1', v(1, 0, 0));
    const hits = await store.search('A', v(1, 0, 0), OPTIONS);
    expect(hits.map((h) => h.articleId)).toEqual(['a1']);
    expect(hits.every((h) => h.tenantId === 'A')).toBe(true);
  });

  it('refuses to store a chunk for an article the tenant does not own', async () => {
    const { store, dir } = setup();
    const b1 = dir.articles.find((a) => a.id === 'b1')!;
    const written = await store.replaceArticleChunks({ tenantId: 'A', articleId: 'b1', contentHash: contentHashOf(b1.title, b1.content), model: 'm1', dimensions: 3, chunks: [{ index: 0, heading: null, text: 'x', embedding: v(1, 0, 0) }] });
    expect(written).toBe(0);
    expect(await store.countChunks('A', 'm1')).toBe(0);
  });

  it('skips deactivated articles', async () => {
    const { store, put, dir } = setup();
    await put('A', 'a2', v(1, 0, 0));
    dir.articles.find((a) => a.id === 'a2')!.isActive = false;
    expect(await store.search('A', v(1, 0, 0), OPTIONS)).toEqual([]);
  });

  it('ignores the old vectors of an edited article until it is re-indexed', async () => {
    const { store, put, dir } = setup();
    await put('A', 'a2', v(1, 0, 0));
    dir.articles.find((a) => a.id === 'a2')!.content = 'Completely new text about something else.';
    expect(await store.search('A', v(1, 0, 0), OPTIONS)).toEqual([]);
    expect(await store.hasFreshIndex('A', 'a2', contentHashOf('Location and parking', 'Completely new text about something else.'), 'm1')).toBe(false);
  });

  it('never compares vectors from a different model or dimension count', async () => {
    const { store, put } = setup();
    await put('A', 'a1', v(1, 0, 0), 'other-model');
    await put('A', 'a2', v(1, 0), 'm1', 2);
    expect(await store.search('A', v(1, 0, 0), OPTIONS)).toEqual([]);
  });

  it('drops hits below the minimum similarity, and orders the rest best first within the limit', async () => {
    const { store, put } = setup();
    await put('A', 'a1', v(1, 0, 0));
    await put('A', 'a2', v(1, 1, 0));
    await put('A', 'a3', v(0, 0, 1));
    const hits = await store.search('A', v(1, 0, 0), { ...OPTIONS, limit: 1 });
    expect(hits.map((h) => h.articleId)).toEqual(['a1']);
    const all = await store.search('A', v(1, 0, 0), OPTIONS);
    expect(all.map((h) => h.articleId)).toEqual(['a1', 'a2']);
    expect(all.some((h) => h.articleId === 'a3')).toBe(false);
  });

  it('replaces an article\'s chunks rather than adding to them', async () => {
    const { store, put } = setup();
    await put('A', 'a1', v(1, 0, 0));
    await put('A', 'a1', v(0, 1, 0));
    expect(await store.countChunks('A', 'm1')).toBe(1);
    expect((await store.search('A', v(1, 0, 0), OPTIONS)).length).toBe(0);
  });

  it('removes an article\'s chunks on delete', async () => {
    const { store, put } = setup();
    await put('A', 'a1', v(1, 0, 0));
    await store.deleteArticleChunks('A', 'a1');
    expect(await store.countChunks('A', 'm1')).toBe(0);
  });
});
