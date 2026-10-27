import { buildRetrievalQuery, scoreArticles } from './knowledge-retrieval.util';

export interface ScorableArticle {
  title: string;
  content: string;
}

export function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length >= 3) ?? []);
}

export function scoreOverlap(queryTerms: Set<string>, docTerms: Set<string>): number {
  let matches = 0;
  for (const term of queryTerms) if (docTerms.has(term)) matches++;
  return matches;
}

// Shared normalization for "is this article equivalent to one we already have" --
// used by both deduplicateArticles() (manual cleanup) and learnFromConversations()
// (pre-insert check) so the two never drift apart into different definitions of
// "duplicate".
export function articleTitleKey(title: string): string {
  return title.toLowerCase().trim();
}

export function articleContentKey(content: string): string {
  return content.slice(0, 300).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function capByCharBudget<T extends ScorableArticle>(articles: T[], maxChars: number): T[] {
  const selected: T[] = [];
  let total = 0;
  for (const article of articles) {
    const size = article.title.length + article.content.length;
    if (selected.length > 0 && total + size > maxChars) break;
    selected.push(article);
    total += size;
  }
  return selected;
}

/**
 * Pure selection logic behind KnowledgeBaseService.getRelevant() -- a bounded, relevance-ranked subset of a tenant's
 * active KB articles for use as LLM prompt context. Ranking lives in knowledge-retrieval.util.ts (stop words,
 * synonyms, term rarity, follow-up context); this applies the caps.
 *
 *  - nothing to look up (a greeting, thanks, an acknowledgement) -> no articles, whatever the KB size;
 *  - a KB no bigger than maxArticles -> all of it (within the character budget): the model can judge, as before;
 *  - a larger KB -> the best matches only. When nothing matches, nothing is returned: five unrelated articles
 *    would only invite the model to stretch them into an answer.
 *
 * Still the dependency-free bridge until vector retrieval exists; deterministic and cheap.
 */
export function selectRelevantArticles<T extends ScorableArticle>(
  all: T[],
  query: string,
  opts: { maxArticles: number; maxChars: number },
  previousCustomerMessages: string[] = [],
): T[] {
  if (all.length === 0) return [];
  const { terms } = buildRetrievalQuery(query, previousCustomerMessages);
  if (terms.size === 0) return [];
  if (all.length <= opts.maxArticles) return capByCharBudget(all, opts.maxChars);

  const scores = scoreArticles(all, { terms });
  const ranked = all
    .map((article, index) => ({ article, index, score: scores[index] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return capByCharBudget(ranked.slice(0, opts.maxArticles).map((r) => r.article), opts.maxChars);
}
