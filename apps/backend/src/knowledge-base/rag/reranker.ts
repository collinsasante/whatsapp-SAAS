import { contentTerms, RetrievalQuery } from '../knowledge-retrieval.util';

/**
 * Reorders the fused candidates before they become prompt context. `LexicalReranker` is deterministic and local (no model call):
 * it rewards candidates that cover the customer's terms, name them in the title or repeat their phrasing, and then spreads the final
 * picks so near-duplicate articles do not crowd out a different relevant one (maximal marginal relevance). A cross-encoder or hosted
 * reranker can replace it by implementing `Reranker`; nothing else changes.
 */
export interface RerankCandidate {
  key: string;
  title: string;
  text: string;
  /** Fusion score from `reciprocalRankFusion`. */
  fusedScore: number;
  vectorScore?: number;
}

export interface Reranker {
  rerank(query: RetrievalQuery, rawQuery: string, candidates: RerankCandidate[], limit: number): RerankCandidate[];
}

const W_FUSED = 0.4;
const W_COVERAGE = 0.3;
const W_TITLE = 0.1;
const W_PHRASE = 0.1;
const W_VECTOR = 0.1;
const MMR_LAMBDA = 0.75;

function bigrams(terms: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < terms.length; i++) out.add(`${terms[i]} ${terms[i + 1]}`);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

export class LexicalReranker implements Reranker {
  rerank(query: RetrievalQuery, rawQuery: string, candidates: RerankCandidate[], limit: number): RerankCandidate[] {
    if (candidates.length === 0 || limit <= 0) return [];
    const queryTerms = query.terms.size > 0 ? query.terms : query.hintTerms;
    const totalWeight = [...queryTerms.values()].reduce((a, b) => a + b, 0) || 1;
    const queryBigrams = bigrams(contentTerms(rawQuery));
    const maxFused = Math.max(...candidates.map((c) => c.fusedScore)) || 1;

    const scored = candidates.map((c) => {
      const titleTerms = new Set(contentTerms(c.title));
      const bodyTerms = contentTerms(c.text);
      const bodySet = new Set(bodyTerms);
      let covered = 0, titleCovered = 0;
      for (const [term, weight] of queryTerms) {
        if (titleTerms.has(term) || bodySet.has(term)) covered += weight;
        if (titleTerms.has(term)) titleCovered += weight;
      }
      const candidateBigrams = bigrams([...contentTerms(c.title), ...bodyTerms]);
      let phrase = 0;
      for (const b of queryBigrams) if (candidateBigrams.has(b)) phrase++;
      const score =
        W_FUSED * (c.fusedScore / maxFused) +
        W_COVERAGE * (covered / totalWeight) +
        W_TITLE * (titleCovered / totalWeight) +
        W_PHRASE * (queryBigrams.size > 0 ? phrase / queryBigrams.size : 0) +
        W_VECTOR * Math.max(0, c.vectorScore ?? 0);
      return { candidate: c, score, terms: new Set([...titleTerms, ...bodySet]) };
    });

    const picked: typeof scored = [];
    const pool = scored.slice().sort((a, b) => b.score - a.score || a.candidate.key.localeCompare(b.candidate.key));
    while (picked.length < limit && pool.length > 0) {
      let bestIndex = 0, bestValue = -Infinity;
      pool.forEach((entry, i) => {
        const redundancy = picked.length === 0 ? 0 : Math.max(...picked.map((p) => jaccard(entry.terms, p.terms)));
        const value = MMR_LAMBDA * entry.score - (1 - MMR_LAMBDA) * redundancy;
        if (value > bestValue) { bestValue = value; bestIndex = i; }
      });
      picked.push(pool.splice(bestIndex, 1)[0]);
    }
    return picked.map((p) => p.candidate);
  }
}
