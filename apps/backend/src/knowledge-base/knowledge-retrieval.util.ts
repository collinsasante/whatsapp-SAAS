/**
 * Term-weighted knowledge-base ranking. Replaces plain word-overlap counting, which treated "you", "what" and
 * "the" as evidence: "what time do you open" ranked Payment above Opening hours, a bare "Hi" pulled in five
 * unrelated articles, and a follow-up like "and how much for delivery?" lost the product being discussed.
 *
 * No model calls, no dependencies, deterministic:
 *  - stop words and chat filler (including common Ghanaian chat words) carry no weight;
 *  - a light stemmer folds plurals and -ing/-ed forms;
 *  - a small synonym table links everyday and local wording to how articles are usually written
 *    ("momo" and "mobile money", "cost" and "price", "deliver" and "shipping");
 *  - rare terms count for more than common ones (inverse document frequency), and a title hit counts for more
 *    than a body hit;
 *  - a message with no real content (greeting, thanks, "ok", an emoji) retrieves nothing;
 *  - a thin message ("and the 500g?") borrows the subject from the customer's own previous messages, at lower weight.
 */

const STOP_WORDS = new Set((
  'a an the and or but if so as is are was were be been being am do does did done have has had having can could will would shall should may might must ' +
  'you your yours yourself i me my mine we our ours us he him his she her hers it its they them their this that these those ' +
  'what which who whom whose when where why how much many any some all more most other another each every ' +
  'with without for from to into onto in on at of by about over under up down out off as than then too very really quite just also still even ' +
  'there here now today please pls plz kindly pliz ' +
  'hi hello hey hiya good morning afternoon evening night ok okay okk kk alright all right thanks thank thx tanx ty cheers ' +
  'yes yeah yep yup no nope nah sure fine cool great nice awesome perfect lovely noted well wow oh ah hmm hmmm lol haha ' +
  'bye goodbye later welcome ' +
  'want need get got give tell let know like see look check ask wanna gonna sell selling buy buying ' +
  'abeg chale charley boss sir madam maame paapa oga dear dey don wey na dem fa ' +
  'sorry pardon again ' +
  'something anything thing things one ones ' +
  'ever will'
).split(/\s+/).filter(Boolean));

/** Words that look like content but are only the shape of a question: they decide which topic to look for. */
const INTENT_HINTS: Array<{ test: RegExp; terms: string[] }> = [
  { test: /\bwhere\b/i, terms: ['location', 'address', 'shop'] },
  { test: /\b(what\s+time|when)\b/i, terms: ['open', 'hour', 'closing'] },
  { test: /\bhow\s+much\b/i, terms: ['price'] },
];

const SYNONYM_GROUPS: string[][] = [
  ['momo', 'mobile', 'money', 'mtn', 'vodafone', 'telecel', 'airteltigo', 'airtel', 'tigo', 'wallet'],
  ['pay', 'payment', 'paid', 'paying', 'checkout', 'card', 'transfer', 'cash', 'deposit'],
  ['deliver', 'delivery', 'shipping', 'ship', 'dispatch', 'rider', 'courier', 'waybill', 'send'],
  ['price', 'cost', 'charge', 'rate', 'fee', 'amount', 'cedi', 'cedis', 'ghs', 'ghc'],
  ['open', 'opening', 'close', 'closing', 'hour', 'hours', 'schedule'],
  ['location', 'address', 'shop', 'store', 'office', 'branch', 'visit', 'directions', 'located', 'find'],
  ['return', 'refund', 'exchange', 'swap', 'replace', 'replacement', 'damaged', 'faulty', 'warranty'],
  ['wholesale', 'bulk', 'discount', 'carton', 'dozen', 'reseller'],
  ['order', 'track', 'tracking', 'status', 'update'],
];

export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

const SYNONYMS = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  const stems = group.map(stem);
  for (const s of stems) {
    const set = SYNONYMS.get(s) ?? new Set<string>();
    for (const other of stems) if (other !== s) set.add(other);
    SYNONYMS.set(s, set);
  }
}

/** Letters (any script, so Twi and Ewe letters survive) and digits; words of 3+ letters, or anything with a digit ("500g"). */
export function contentTerms(text: string): string[] {
  const words = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue;
    if (!/\d/.test(w) && w.length < 3) continue;
    terms.push(stem(w));
  }
  return terms;
}

function intentTerms(text: string): string[] {
  return INTENT_HINTS.filter((h) => h.test.test(text)).flatMap((h) => h.terms.map(stem));
}

export interface RetrievalQuery {
  /** Term -> weight. Empty means "nothing to look up" (a greeting, thanks, an acknowledgement). */
  terms: Map<string, number>;
  /**
   * Terms implied by a question word ("where" -> location, "when" -> hours). Used only when no article matches
   * anything the customer actually said, so a generic question word can never outrank a real content match.
   */
  hintTerms: Map<string, number>;
}

/** Words that refer to something said earlier instead of naming it. */
const POINTS_BACK = /\b(it|that|this|those|these|them|one|ones|other|another|same|there)\b/i;
/**
 * A question or a request, as opposed to an acknowledgement ("ok that is fine", "thanks for that"). Deliberately NOT any message that
 * merely contains "is" or "can": a question mark, a request verb, or a question opener at the start of the message.
 */
const ASKS_FOR_SOMETHING = /\?|\b(want|need|take|buy|order|get|give me|let me have|i'?ll take)\b|^\s*(?:and |so |but |ok |okay )?(is|are|do|does|can|could|will|what|which|how|when|where)\b/i;

const OWN_WORDS = 1;
const SYNONYM_WEIGHT = 0.7;
const CONTEXT_WEIGHT = 0.6;
const THIN_MESSAGE_TERMS = 2;
const CONTEXT_MESSAGES = 2;

export function buildRetrievalQuery(current: string, previousCustomerMessages: string[] = []): RetrievalQuery {
  const terms = new Map<string, number>();
  const put = (term: string, weight: number) => {
    if (weight > (terms.get(term) ?? 0)) terms.set(term, weight);
  };
  const named = [...new Set(contentTerms(current))];
  const hinted = [...new Set(intentTerms(current))].filter((t) => !named.includes(t));
  for (const t of named) put(t, OWN_WORDS);
  const own = [...named, ...hinted];

  // A thin message ("and the 500g?", "how much for delivery?") keeps its subject from what the customer said just
  // before. A greeting or "ok" has no terms at all and is NOT given context: it asks for nothing. The exception is a message that
  // has no terms of its own because its subject is a pronoun ("I want that one", "can I get it today?", "what about the other
  // one?"): it points back at what was just discussed and asks for something, so it borrows that subject too.
  const pointsBack = own.length === 0 && POINTS_BACK.test(current) && ASKS_FOR_SOMETHING.test(current);
  if (pointsBack || (own.length > 0 && own.length < THIN_MESSAGE_TERMS)) {
    let used = 0;
    for (let i = previousCustomerMessages.length - 1; i >= 0 && used < CONTEXT_MESSAGES; i--) {
      const before = contentTerms(previousCustomerMessages[i]);
      if (before.length === 0) continue;
      for (const t of before) put(t, CONTEXT_WEIGHT);
      used++;
    }
  }

  for (const [term, weight] of [...terms]) {
    for (const syn of SYNONYMS.get(term) ?? []) put(syn, weight * SYNONYM_WEIGHT);
  }

  const hintTerms = new Map<string, number>();
  for (const t of hinted) hintTerms.set(t, OWN_WORDS);
  for (const [term, weight] of [...hintTerms]) {
    for (const syn of SYNONYMS.get(term) ?? []) if (!hintTerms.has(syn)) hintTerms.set(syn, weight * SYNONYM_WEIGHT);
  }
  return { terms, hintTerms };
}

export interface RankableArticle {
  title: string;
  content: string;
}

const TITLE_FACTOR = 2.5;

/** Relevance score per article, in the same order as `articles`. A score of 0 means no query term appears. */
export function scoreArticles(articles: RankableArticle[], query: RetrievalQuery): number[] {
  const scores = scoreTerms(articles, query.terms);
  if (scores.some((x) => x > 0) || query.hintTerms.size === 0) return scores;
  return scoreTerms(articles, query.hintTerms);
}

const TYPO_WEIGHT = 0.8;
const TYPO_MIN_LENGTH = 5;

/** True when `a` and `b` differ by exactly one inserted, deleted or substituted letter (or one swap of neighbours). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // one swap
  }
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return longer.slice(i + 1) === shorter.slice(i); // one insertion or deletion
}

/**
 * Customers misspell ("delivary", "recieve"). A query word that appears in no article is matched to an article word that is one
 * edit away, at slightly lower weight. Deliberately narrow so it cannot manufacture a match: only words of 5+ letters, only when the
 * word matches nothing exactly, only the same first letter, and only one edit.
 */
function withTypoTolerance(terms: Map<string, number>, docs: Array<{ title: Set<string>; body: Set<string> }>): Map<string, number> {
  const vocabulary = new Set<string>();
  for (const d of docs) { for (const t of d.title) vocabulary.add(t); for (const t of d.body) vocabulary.add(t); }
  const out = new Map(terms);
  for (const [term, weight] of terms) {
    if (term.length < TYPO_MIN_LENGTH || /\d/.test(term) || vocabulary.has(term)) continue;
    for (const known of vocabulary) {
      if (known[0] === term[0] && known.length >= TYPO_MIN_LENGTH && withinOneEdit(term, known) && weight * TYPO_WEIGHT > (out.get(known) ?? 0)) out.set(known, weight * TYPO_WEIGHT);
    }
  }
  return out;
}

function scoreTerms(articles: RankableArticle[], rawTerms: Map<string, number>): number[] {
  const docs = articles.map((a) => ({
    title: new Set(contentTerms(a.title)),
    body: new Set(contentTerms(a.content)),
  }));
  const terms = withTypoTolerance(rawTerms, docs);
  const df = new Map<string, number>();
  for (const term of terms.keys()) {
    df.set(term, docs.filter((d) => d.title.has(term) || d.body.has(term)).length);
  }
  const n = Math.max(articles.length, 1);
  return docs.map((d) => {
    let score = 0;
    for (const [term, weight] of terms) {
      const inTitle = d.title.has(term);
      if (!inTitle && !d.body.has(term)) continue;
      const idf = Math.log(1 + n / (1 + (df.get(term) ?? 0)));
      score += weight * idf * (inTitle ? TITLE_FACTOR : 1);
    }
    return score;
  });
}
