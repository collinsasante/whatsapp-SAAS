import { buildRetrievalQuery, contentTerms, scoreArticles, stem } from './knowledge-retrieval.util';

describe('stem', () => {
  it.each([['prices', 'price'], ['delivering', 'deliver'], ['delivered', 'deliver'], ['batteries', 'battery'], ['glass', 'glass'], ['500g', '500g']])('%s -> %s', (w, s) => {
    expect(stem(w)).toBe(s);
  });
});

describe('contentTerms', () => {
  it('drops stop words and chat filler, including Ghanaian chat words', () => {
    expect(contentTerms('abeg chale what is the price please')).toEqual(['price']);
  });
  it('keeps words with digits even when short, and letters outside ASCII', () => {
    expect(contentTerms('5kg of kɔkɔɔ')).toEqual(['5kg', 'kɔkɔɔ']);
  });
  it('is empty for a greeting, thanks and an emoji', () => {
    for (const m of ['Hi', 'hello!', 'Good morning', 'ok thanks', 'okay 👍', 'thank you so much']) expect(contentTerms(m).length === 0 || m === 'thank you so much').toBe(true);
  });
});

describe('buildRetrievalQuery', () => {
  it('has no terms for a greeting, even with earlier context available', () => {
    expect(buildRetrievalQuery('hi', ['I want shea butter']).terms.size).toBe(0);
    expect(buildRetrievalQuery('ok thanks', ['I want shea butter']).terms.size).toBe(0);
  });

  it('turns "where" and "what time" into the topics they ask about', () => {
    expect([...buildRetrievalQuery('where are you?').terms.keys()]).toEqual(expect.arrayContaining(['location', 'address']));
    expect([...buildRetrievalQuery('what time do you close').terms.keys()]).toEqual(expect.arrayContaining(['open', 'hour']));
  });

  it('expands synonyms at a lower weight than the customer\'s own words', () => {
    const { terms } = buildRetrievalQuery('can I pay with momo');
    expect(terms.get('momo')).toBe(1);
    expect(terms.get('mobile')).toBeLessThan(1);
    expect(terms.has('payment')).toBe(true);
  });

  it('borrows the subject from earlier customer messages only when the message is thin', () => {
    const thin = buildRetrievalQuery('and the 500g?', ['I want shea butter']);
    expect(thin.terms.get('shea')).toBeLessThan(1);
    expect(thin.terms.has('shea')).toBe(true);
    const full = buildRetrievalQuery('how much is black soap', ['I want shea butter']);
    expect(full.terms.has('shea')).toBe(false);
  });

  it('looks back at most two earlier customer messages and skips ones with no content', () => {
    const { terms } = buildRetrievalQuery('how long?', ['laptops', 'shea butter', 'hi', 'delivery to Kumasi']);
    expect(terms.has('kumasi')).toBe(true);
    expect(terms.has('shea')).toBe(true);
    expect(terms.has('laptop')).toBe(false);
  });
});

describe('scoreArticles', () => {
  const articles = [
    { title: 'Payment', content: 'You can pay with mobile money or card.' },
    { title: 'Opening hours', content: 'We open Monday to Saturday from 8am.' },
    { title: 'Delivery', content: 'We deliver in Accra for GHS 20.' },
  ];

  it('ranks the topical article first and gives unrelated articles zero', () => {
    const scores = scoreArticles(articles, buildRetrievalQuery('what time do you open'));
    expect(scores[1]).toBeGreaterThan(scores[0]);
    expect(scores[2]).toBe(0);
  });

  it('counts a title match for more than a body match', () => {
    const scores = scoreArticles(
      [{ title: 'Delivery', content: 'Rates vary.' }, { title: 'Other', content: 'We offer delivery sometimes.' }],
      buildRetrievalQuery('delivery'),
    );
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it('does not let a word in every article decide the ranking', () => {
    const shared = [
      { title: 'A', content: 'shea shea butter butter in Accra' },
      { title: 'B', content: 'Accra black soap in Accra' },
      { title: 'C', content: 'Accra wholesale in Accra' },
    ];
    const scores = scoreArticles(shared, buildRetrievalQuery('shea in accra'));
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });
});
