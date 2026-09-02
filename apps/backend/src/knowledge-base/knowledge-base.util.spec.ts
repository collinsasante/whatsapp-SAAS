import {
  articleContentKey,
  articleTitleKey,
  capByCharBudget,
  scoreOverlap,
  selectRelevantArticles,
  tokenize,
} from './knowledge-base.util';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric characters', () => {
    expect(tokenize('Refund Policy: 30-Day Window!')).toEqual(new Set(['refund', 'policy', 'day', 'window']));
  });

  it('drops words shorter than 3 characters', () => {
    expect(tokenize('a to be or')).toEqual(new Set());
  });

  it('returns an empty set for content with no alphanumeric words', () => {
    expect(tokenize('👍👍👍 !!! ---')).toEqual(new Set());
  });
});

describe('scoreOverlap', () => {
  it('counts shared terms between query and document', () => {
    const query = new Set(['refund', 'policy']);
    const doc = new Set(['our', 'refund', 'policy', 'window']);
    expect(scoreOverlap(query, doc)).toBe(2);
  });

  it('returns 0 when there is no overlap', () => {
    expect(scoreOverlap(new Set(['shipping']), new Set(['refund', 'policy']))).toBe(0);
  });
});

describe('articleTitleKey / articleContentKey', () => {
  it('normalizes title case and whitespace', () => {
    expect(articleTitleKey('  Refund Policy  ')).toBe('refund policy');
    expect(articleTitleKey('REFUND POLICY')).toBe('refund policy');
  });

  it('normalizes content to a lowercased, whitespace-collapsed prefix', () => {
    const a = articleContentKey('We  offer   refunds\nwithin 30 days.');
    const b = articleContentKey('we offer refunds within 30 days.');
    expect(a).toBe(b);
  });

  it('truncates content comparison to the first 300 characters', () => {
    const shared = 'x'.repeat(300);
    const a = articleContentKey(shared + 'AAAA');
    const b = articleContentKey(shared + 'BBBB');
    expect(a).toBe(b);
  });
});

describe('capByCharBudget', () => {
  const article = (title: string, content: string) => ({ title, content });

  it('always includes at least one article even if it exceeds the budget alone', () => {
    const huge = article('Big', 'x'.repeat(10_000));
    expect(capByCharBudget([huge], 100)).toEqual([huge]);
  });

  it('stops adding once the next article would exceed the budget', () => {
    const a = article('A', 'x'.repeat(50));
    const b = article('B', 'x'.repeat(50));
    const c = article('C', 'x'.repeat(50));
    const result = capByCharBudget([a, b, c], 120);
    expect(result).toEqual([a, b]);
  });

  it('includes everything when well under budget', () => {
    const a = article('A', 'short');
    const b = article('B', 'short');
    expect(capByCharBudget([a, b], 10_000)).toEqual([a, b]);
  });
});

describe('selectRelevantArticles', () => {
  const article = (title: string, content: string) => ({ title, content });

  it('returns an empty array when there are no articles', () => {
    expect(selectRelevantArticles([], 'anything', { maxArticles: 5, maxChars: 6000 })).toEqual([]);
  });

  it('returns all articles (capped by budget) when the KB is smaller than maxArticles', () => {
    const articles = [article('Hours', 'We are open 9-5.'), article('Location', 'We are downtown.')];
    const result = selectRelevantArticles(articles, 'what are your hours', { maxArticles: 5, maxChars: 6000 });
    expect(result).toHaveLength(2);
  });

  it('picks only articles relevant to the query when the KB exceeds maxArticles', () => {
    const articles = [
      article('Refund Policy', 'We offer refunds within 30 days of purchase.'),
      article('Shipping Times', 'Orders ship within 2 business days.'),
      article('Store Hours', 'Open Monday through Friday, 9am to 5pm.'),
      article('Contact Support', 'Email support@example.com for help.'),
      article('Return Process', 'To return an item, contact support first.'),
      article('Payment Methods', 'We accept Visa, Mastercard, and Amex.'),
    ];
    const result = selectRelevantArticles(articles, 'What is your refund policy?', { maxArticles: 3, maxChars: 6000 });

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.some((a) => a.title === 'Refund Policy')).toBe(true);
    // Should not pull in every unrelated article just because the KB is large.
    expect(result.some((a) => a.title === 'Payment Methods')).toBe(false);
  });

  it('never returns more than maxArticles articles', () => {
    const articles = Array.from({ length: 20 }, (_, i) => article(`Topic ${i}`, `Content about topic ${i} and refunds.`));
    const result = selectRelevantArticles(articles, 'refunds', { maxArticles: 5, maxChars: 100_000 });
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('never exceeds the character budget by more than one article', () => {
    const articles = Array.from({ length: 20 }, (_, i) => article(`Topic ${i}`, 'x'.repeat(1000)));
    const result = selectRelevantArticles(articles, 'topic', { maxArticles: 20, maxChars: 3000 });
    const totalChars = result.reduce((sum, a) => sum + a.title.length + a.content.length, 0);
    // Budget (3000) plus at most one more full article's worth of overflow.
    expect(totalChars).toBeLessThanOrEqual(3000 + 1010);
  });

  it('falls back to the most recent articles (bounded) when the query has no matchable keywords', () => {
    const articles = Array.from({ length: 10 }, (_, i) => article(`Topic ${i}`, `Content ${i}`));
    const result = selectRelevantArticles(articles, '👍👍👍', { maxArticles: 3, maxChars: 100_000 });
    expect(result).toHaveLength(3);
    // Most recently added = last in the array (getActive orders by createdAt asc).
    expect(result.map((a) => a.title)).toEqual(['Topic 7', 'Topic 8', 'Topic 9']);
  });

  it('is deterministic -- same input always produces the same output', () => {
    const articles = Array.from({ length: 10 }, (_, i) => article(`Topic ${i}`, `Content about refunds and topic ${i}`));
    const run = () => selectRelevantArticles(articles, 'refund topic', { maxArticles: 4, maxChars: 6000 });
    expect(run()).toEqual(run());
  });

  it('falls back to all scored articles when none score above zero relevance', () => {
    const articles = [
      article('Hours', 'We open at nine'),
      article('Location', 'We are downtown'),
      article('Contact', 'Email us anytime'),
      article('Policy', 'Standard terms apply'),
      article('Payments', 'Cards accepted here'),
      article('Shipping', 'We ship worldwide'),
    ];
    // Query shares no real keywords with any article.
    const result = selectRelevantArticles(articles, 'xyzzy plugh', { maxArticles: 3, maxChars: 100_000 });
    expect(result).toHaveLength(3);
  });
});
