import { chunkDocument, DEFAULT_CHUNK_OPTIONS, resolveChunkOptions } from './semantic-chunker';

const sentence = (n: number) => `This is sentence number ${n} about the bakery and what it sells every single day.`;
const paragraph = (start: number, count: number) => Array.from({ length: count }, (_, i) => sentence(start + i)).join(' ');

describe('chunkDocument', () => {
  it('keeps a short document as one chunk, exactly as written', () => {
    expect(chunkDocument('We open at nine.')).toEqual([{ index: 0, heading: null, text: 'We open at nine.' }]);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('  \n\n ')).toEqual([]);
  });

  it('splits a long document on paragraph boundaries and numbers the chunks in order', () => {
    const doc = [paragraph(1, 6), paragraph(7, 6), paragraph(13, 6)].join('\n\n');
    const chunks = chunkDocument(doc, { targetChars: 500, maxChars: 800, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.text.length <= 800)).toBe(true);
  });

  it('never ends a chunk in the middle of a sentence', () => {
    const doc = Array.from({ length: 40 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkDocument(doc, { targetChars: 400, maxChars: 700, overlapChars: 80 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.text).toMatch(/[.!?]$/);
  });

  it('repeats the last sentence(s) of a chunk at the start of the next, within the configured overlap', () => {
    const doc = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkDocument(doc, { targetChars: 400, maxChars: 700, overlapChars: 100 });
    for (let i = 1; i < chunks.length; i++) {
      const lastSentenceOfPrevious = chunks[i - 1].text.split(/(?<=[.!?])\s+/).pop()!;
      expect(chunks[i].text.startsWith(lastSentenceOfPrevious)).toBe(true);
    }
  });

  it('adds no overlap when overlapChars is 0, so no sentence is repeated', () => {
    const doc = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ');
    const text = chunkDocument(doc, { targetChars: 400, maxChars: 700, overlapChars: 0 }).map((c) => c.text).join(' ');
    const occurrences = (s: string) => text.split(s).length - 1;
    for (let i = 0; i < 30; i++) expect(occurrences(sentence(i))).toBe(1);
  });

  it('starts a new chunk at a markdown heading, records the heading, and does not overlap across it', () => {
    const doc = `# Delivery\n${paragraph(1, 8)}\n\n# Refunds\n${paragraph(100, 8)}`;
    const chunks = chunkDocument(doc, { targetChars: 400, maxChars: 700, overlapChars: 100 });
    const delivery = chunks.filter((c) => c.heading === 'Delivery');
    const refunds = chunks.filter((c) => c.heading === 'Refunds');
    expect(delivery.length).toBeGreaterThan(0);
    expect(refunds.length).toBeGreaterThan(0);
    expect(delivery.every((c) => !c.text.includes('sentence number 10'))).toBe(true);
    expect(refunds[0].text.startsWith(sentence(100))).toBe(true);
  });

  it('splits one very long paragraph at sentences, and a single huge sentence at whitespace as a last resort', () => {
    const huge = `${'word '.repeat(600).trim()}.`;
    const chunks = chunkDocument(`${paragraph(1, 3)} ${huge}`, { targetChars: 400, maxChars: 600, overlapChars: 0 });
    expect(chunks.every((c) => c.text.length <= 600)).toBe(true);
    expect(chunks.map((c) => c.text).join(' ')).toContain('word word word');
  });

  it('merges a tiny trailing fragment into the previous chunk', () => {
    const doc = `${paragraph(1, 7)}\n\nThanks.`;
    const chunks = chunkDocument(doc, { targetChars: 500, maxChars: 700, overlapChars: 0, minChars: 100 });
    expect(chunks[chunks.length - 1].text.endsWith('Thanks.')).toBe(true);
    expect(chunks.every((c) => c.text.length >= 100)).toBe(true);
  });

  it('is deterministic', () => {
    const doc = Array.from({ length: 25 }, (_, i) => sentence(i)).join(' ');
    expect(chunkDocument(doc, { targetChars: 400, maxChars: 700 })).toEqual(chunkDocument(doc, { targetChars: 400, maxChars: 700 }));
  });

  it.each([
    [{ overlapChars: 900 }, /overlapChars/],
    [{ maxChars: 100, targetChars: 800 }, /maxChars/],
    [{ targetChars: 10 }, /targetChars/],
    [{ overlapChars: -1 }, /non-negative/],
  ])('rejects invalid options %j', (options, message) => {
    expect(() => resolveChunkOptions(options)).toThrow(message);
  });

  it('defaults are consistent', () => {
    expect(() => resolveChunkOptions()).not.toThrow();
    expect(DEFAULT_CHUNK_OPTIONS.overlapChars).toBeLessThan(DEFAULT_CHUNK_OPTIONS.targetChars);
  });
});
