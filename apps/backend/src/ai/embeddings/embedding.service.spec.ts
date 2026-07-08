import { LocalHashingEmbeddingService, cosineSimilarity } from './embedding.service';

describe('LocalHashingEmbeddingService', () => {
  const svc = new LocalHashingEmbeddingService();

  it('produces a unit-length (normalized) vector', async () => {
    const [vec] = await svc.embed(['What are your business hours?']);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic across calls', async () => {
    const [a] = await svc.embed(['How much does the Pro plan cost?']);
    const [b] = await svc.embed(['How much does the Pro plan cost?']);
    expect(a).toEqual(b);
  });

  it('scores near-duplicate questions higher than unrelated ones', async () => {
    const [base] = await svc.embed(['How much does the Pro plan cost?']);
    const [paraphrase] = await svc.embed(['What is the price of the Pro plan?']);
    const [unrelated] = await svc.embed(['Do you support Telegram integration?']);

    const paraphraseScore = cosineSimilarity(base, paraphrase);
    const unrelatedScore = cosineSimilarity(base, unrelated);
    expect(paraphraseScore).toBeGreaterThan(unrelatedScore);
  });

  it('scores identical text as similarity 1', async () => {
    const [a] = await svc.embed(['Refunds are available within 14 days.']);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });
});

describe('cosineSimilarity', () => {
  it('returns 0 for a zero vector (no divide-by-zero crash)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});
