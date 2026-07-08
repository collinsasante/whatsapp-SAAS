import { chunkArticle } from './chunking.util';

describe('chunkArticle', () => {
  it('keeps a short article as a single chunk', () => {
    const chunks = chunkArticle('Refund Policy', 'We offer refunds within 14 days of purchase.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Refund Policy');
    expect(chunks[0].content).toContain('14 days');
  });

  it('splits on markdown headings', () => {
    const content = [
      '# Shipping',
      'We ship within 3 business days.',
      '',
      '# Returns',
      'Returns are accepted within 30 days.',
    ].join('\n');
    const chunks = chunkArticle('Policies', content);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.heading === 'Shipping')).toBe(true);
    expect(chunks.some((c) => c.heading === 'Returns')).toBe(true);
  });

  it('splits on colon-style section headings', () => {
    const content = 'Pricing:\nStarter is $16/month.\n\nSupport:\nEmail us anytime.';
    const chunks = chunkArticle('Plans', content);
    expect(chunks.some((c) => c.heading === 'Pricing')).toBe(true);
    expect(chunks.some((c) => c.heading === 'Support')).toBe(true);
  });

  it('falls back to paragraph breaks when there are no headings', () => {
    const content = 'First paragraph about pricing.\n\nSecond paragraph about support.';
    const chunks = chunkArticle('General', content);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.heading === null)).toBe(true);
  });

  it('splits an oversized section into overlapping chunks', () => {
    const longBody = Array.from({ length: 400 }, (_, i) => `sentence number ${i}`).join('. ');
    const chunks = chunkArticle('Big Article', longBody);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should carry the article title for identity when retrieved in isolation.
    expect(chunks.every((c) => c.content.startsWith('Big Article'))).toBe(true);
  });

  it('never produces an empty chunk list', () => {
    const chunks = chunkArticle('Empty-ish', '   ');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
