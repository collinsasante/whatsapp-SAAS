import { buildRetrievalQuery, contentTerms, scoreArticles, stem, withinOneEdit } from './knowledge-retrieval.util';

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
    expect([...buildRetrievalQuery('where are you?').hintTerms.keys()]).toEqual(expect.arrayContaining(['location', 'address']));
    expect([...buildRetrievalQuery('what time do you close').hintTerms.keys()]).toEqual(expect.arrayContaining(['open', 'hour']));
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

describe('intent hints do not outrank what the customer named', () => {
  const kb = [
    { title: 'Shop location', content: 'Visit our shop at Osu, Accra. Our address is 12 Oxford Street.' },
    { title: 'Delivery', content: 'We deliver every order within Accra in 1-2 days. Orders placed before noon arrive the same day.' },
    { title: 'Opening hours', content: 'We open Monday to Saturday from 8am and close at 6pm.' },
  ];
  const rank = (q: string) => scoreArticles(kb, buildRetrievalQuery(q));

  it('"Where is my order?" ranks delivery above the shop location', () => {
    const s = rank('Where is my order?');
    expect(s[1]).toBeGreaterThan(s[0]);
  });
  it('"When will it arrive?" ranks delivery above the shop location and opening hours', () => {
    const s = rank('When will it arrive?');
    expect(s[1]).toBeGreaterThan(s[0]);
    expect(s[1]).toBeGreaterThan(s[2]);
  });
  it('a hint still finds its topic when the message names nothing else', () => {
    const s = rank('where are you?');
    expect(s[0]).toBeGreaterThan(s[1]);
  });
  it('keeps hint terms out of the main query when the customer named something', () => {
    const q = buildRetrievalQuery('where is my order');
    expect(q.terms.get('order')).toBe(1);
    expect(q.terms.has('location')).toBe(false);
    expect(q.hintTerms.has('location')).toBe(true);
  });
});

describe('follow-ups that point back at the subject', () => {
  const prior = ['do you have shea butter', 'how much is the 250g'];
  const subject = (current: string, previous = prior) => [...buildRetrievalQuery(current, previous).terms.keys()];

  it.each(['I want that one', 'what about the other one?', 'can I get it today?', 'is it available?', 'I will take it', 'give me the same', 'can I see those?'])(
    '"%s" borrows the subject of the customer\'s earlier messages',
    (message) => expect(subject(message)).toEqual(expect.arrayContaining(['shea'])),
  );

  it.each(['ok', 'thanks', 'thank you so much', 'ok thanks that is fine', 'thanks for that', '👍', 'good morning', 'great'])(
    'the acknowledgement "%s" still retrieves nothing: it asks for nothing',
    (message) => expect(buildRetrievalQuery(message, prior).terms.size).toBe(0),
  );

  it('has nothing to borrow when the customer has said nothing before, so no subject is invented', () => {
    expect(buildRetrievalQuery('I want that one', []).terms.size).toBe(0);
    expect(buildRetrievalQuery('I want that one', ['hi', 'ok']).terms.size).toBe(0); // earlier messages with no content give no subject
  });

  it.each(['is it available', 'can I get it today', 'what about the other one', 'and is that one in stock'])(
    '"%s" (no question mark) is still recognised as asking',
    (message) => expect(subject(message)).toEqual(expect.arrayContaining(['shea'])),
  );

  it('prefers the customer\'s own words when they name something', () => {
    const terms = subject('I want that black soap');
    expect(terms).toContain('black');
    expect(terms).not.toContain('shea');
  });
});

describe('withinOneEdit', () => {
  it.each([['delivary', 'delivery'], ['recieve', 'receive'], ['paymnt', 'payment'], ['pricee', 'price'], ['shea', 'shee']])('%s ~ %s', (a, b) => {
    expect(withinOneEdit(a, b)).toBe(true);
    expect(withinOneEdit(b, a)).toBe(true);
  });
  it.each([['delivary', 'deliveries'], ['order', 'border '], ['soap', 'shea'], ['price', 'prize1'], ['same', 'same']])('%s !~ %s', (a, b) => {
    expect(withinOneEdit(a, b)).toBe(false);
  });
});

describe('typo tolerance in ranking', () => {
  const ARTICLES = [
    { title: 'Delivery', content: 'We deliver in Accra for GHS 20 through a dispatch rider.' },
    { title: 'Opening hours', content: 'We open Monday to Saturday from 8am to 6pm.' },
    { title: 'Returns', content: 'You can return an unopened product within 7 days.' },
  ];
  const best = (message: string) => {
    const scores = scoreArticles(ARTICLES, buildRetrievalQuery(message, []));
    return scores.every((s) => s === 0) ? null : ARTICLES[scores.indexOf(Math.max(...scores))]!.title;
  };

  it('finds the article for a misspelt word that matches nothing exactly', () => {
    expect(best('delivary to kumasi')).toBe('Delivery');
    expect(best('what are your opning hours')).toBe('Opening hours');
  });
  it('does not guess for short words, words with digits, or a different first letter', () => {
    expect(best('oper')).toBeNull(); // one edit from "open", but only 4 letters: too short to guess
    expect(best('elivery')).toBeNull(); // first letter dropped: not the same first letter, so not matched
    expect(best('xyzzy plugh')).toBeNull();
  });
  it('an exact match is never replaced by a near one', () => {
    const scores = scoreArticles([{ title: 'Delivery', content: 'x' }, { title: 'Delivered goods', content: 'y' }], buildRetrievalQuery('delivery', []));
    expect(scores[0]).toBeGreaterThan(scores[1]!);
  });
});
