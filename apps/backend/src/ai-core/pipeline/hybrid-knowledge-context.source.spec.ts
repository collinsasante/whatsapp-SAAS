import { selectRelevantArticles } from '../../knowledge-base/knowledge-base.util';
import { KnowledgeIndexer } from '../../knowledge-base/rag/knowledge-indexer';
import { ConceptEmbedder } from '../../knowledge-base/rag/testing/concept-embedder';
import { FixtureDirectory, fixtureArticles } from '../../knowledge-base/rag/testing/fixture-kb';
import { InMemoryVectorStore } from '../../knowledge-base/rag/vector-store';
import { HybridKnowledgeContextSource } from './hybrid-knowledge-context.source';
import { KbRelevantContextSource } from './knowledge-context.source';

async function setup(opts: { withVectors: boolean; guidance?: string | Error }) {
  const dir = new FixtureDirectory([...fixtureArticles('A', 'a'), ...fixtureArticles('B', 'b')]);
  const embedder = new ConceptEmbedder();
  const store = new InMemoryVectorStore(dir.record);
  if (opts.withVectors) await new KnowledgeIndexer({ loadActiveArticles: async (t) => dir.activeFor(t), embedder, store }).indexTenant('A');
  const knowledgeBase = {
    getActiveForRetrieval: jest.fn(async (t: string) => dir.activeFor(t)),
    getRelevant: jest.fn(async (t: string, q: string, prev: string[] = []) => selectRelevantArticles(dir.activeFor(t), q, { maxArticles: 5, maxChars: 6000 }, prev)),
  };
  const corrections = {
    getGuidanceBlock: jest.fn(async () => {
      if (opts.guidance instanceof Error) throw opts.guidance;
      return opts.guidance ?? '';
    }),
  };
  const hybrid = new HybridKnowledgeContextSource(knowledgeBase as never, corrections as never, opts.withVectors ? embedder : null, opts.withVectors ? store : null);
  const legacy = new KbRelevantContextSource(knowledgeBase as never, corrections as never);
  return { hybrid, legacy, knowledgeBase, corrections, dir };
}

describe('HybridKnowledgeContextSource', () => {
  it.each([
    'How much is a flat white and an almond croissant?',
    'What are your opening hours on Saturday?',
    'ok thanks',
    'What is the capital of France?',
  ])('produces exactly the keyword-only context for %j when there is no vector side', async (query) => {
    const t = await setup({ withVectors: false, guidance: '\n\nGUIDANCE: be brief' });
    expect(await t.hybrid.getContext('A', query)).toBe(await t.legacy.getContext('A', query));
  });

  it('keeps the same "KNOWLEDGE BASE" block shape and appends the approved-corrections guidance', async () => {
    const t = await setup({ withVectors: true, guidance: '\n\nGUIDANCE: be brief' });
    const context = await t.hybrid.getContext('A', 'Where can I leave my car?');
    expect(context.startsWith('\n\nKNOWLEDGE BASE:\n## Location and parking\n')).toBe(true);
    expect(context.endsWith('\n\nGUIDANCE: be brief')).toBe(true);
    expect(t.corrections.getGuidanceBlock).toHaveBeenCalledWith('A', 'Where can I leave my car?');
  });

  it('answers a paraphrase from the vector side where the keyword source finds nothing', async () => {
    const t = await setup({ withVectors: true });
    const query = 'Is there a spot for my vehicle?';
    expect(await t.legacy.getContext('A', query)).toBe('');
    const { context, trace } = await t.hybrid.getContextWithTrace('A', query);
    expect(context).toContain('## Location and parking');
    expect(trace.mode).toBe('hybrid');
    expect(trace.sources.map((s) => s.articleId)).toEqual(['a2']);
  });

  it('returns a trace of ids and ranks only, never article content', async () => {
    const t = await setup({ withVectors: true });
    const { trace } = await t.hybrid.getContextWithTrace('A', 'Where can I leave my car?');
    const serialised = JSON.stringify(trace);
    expect(serialised).not.toContain('clock tower');
    expect(serialised).toContain('"articleId":"a2"');
  });

  it('never includes another tenant\'s articles', async () => {
    const t = await setup({ withVectors: true });
    t.dir.articles.find((a) => a.id === 'b2')!.content = 'B-ONLY-LOT behind the B branch.';
    expect(await t.hybrid.getContext('A', 'Where can I leave my car?')).not.toContain('B-ONLY-LOT');
  });

  it('falls back to the existing keyword path if retrieval itself fails', async () => {
    const t = await setup({ withVectors: true });
    t.knowledgeBase.getActiveForRetrieval.mockRejectedValueOnce(new Error('db hiccup'));
    const { context, trace } = await t.hybrid.getContextWithTrace('A', 'What are your opening hours on Saturday?');
    expect(context).toContain('## Opening hours');
    expect(trace).toMatchObject({ mode: 'keyword-fallback', fallbackReason: 'retriever_error' });
    expect(t.knowledgeBase.getRelevant).toHaveBeenCalled();
  });

  it('carries on without guidance if the corrections lookup fails', async () => {
    const t = await setup({ withVectors: true, guidance: new Error('corrections down') });
    expect(await t.hybrid.getContext('A', 'Where can I leave my car?')).toContain('## Location and parking');
  });
});
