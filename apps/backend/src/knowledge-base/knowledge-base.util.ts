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
 * Pure selection logic behind KnowledgeBaseService.getRelevant() -- bounded,
 * relevance-filtered subset of a tenant's active KB articles, for use as LLM
 * prompt context instead of sending every active article on every call.
 *
 * Conservative interim fix: the real fix -- vector + full-text hybrid retrieval
 * over chunked/embedded articles (RetrievalService, dev branch only) -- depends on
 * a knowledge_base_chunks table, a generated tsvector column, an embedding
 * pipeline, and a backfill of every existing article. None of that exists on this
 * branch yet, and promoting it here without the backfill would make retrieval
 * return nothing until every article is reprocessed -- a regression, not a fix.
 * This is a dependency-free bridge until that's ready: deterministic term-overlap
 * scoring, hard caps on both article count and total character budget, and a
 * design that degrades to something reasonable rather than silently returning
 * nothing.
 */
export function selectRelevantArticles<T extends ScorableArticle>(
  all: T[],
  query: string,
  opts: { maxArticles: number; maxChars: number },
): T[] {
  if (all.length === 0) return [];
  if (all.length <= opts.maxArticles) {
    // Small KB -- relevance filtering wouldn't reduce anything meaningfully;
    // just keep the character budget so a handful of huge articles can't blow it.
    return capByCharBudget(all, opts.maxChars);
  }

  const queryTerms = tokenize(query);
  if (queryTerms.size === 0) {
    // No usable keywords to match on (e.g. an emoji-only message). Falling back
    // to the whole KB would defeat the point of this function; falling back to
    // nothing would regress replies that currently work. Most-recently-added
    // articles is a reasonable, deterministic middle ground.
    return capByCharBudget([...all].reverse().slice(0, opts.maxArticles).reverse(), opts.maxChars);
  }

  const scored = all
    .map((article) => ({ article, score: scoreOverlap(queryTerms, tokenize(`${article.title} ${article.content}`)) }))
    .sort((a, b) => b.score - a.score);

  const relevant = scored[0]?.score > 0 ? scored.filter((s) => s.score > 0) : scored;
  return capByCharBudget(relevant.slice(0, opts.maxArticles).map((s) => s.article), opts.maxChars);
}
