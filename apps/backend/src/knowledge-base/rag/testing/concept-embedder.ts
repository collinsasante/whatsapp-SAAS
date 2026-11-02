import { EmbeddingInputKind, EmbeddingProvider, normalizeVector } from '../embedding-provider';
import { contentTerms } from '../../knowledge-retrieval.util';

/**
 * TEST SUPPORT ONLY. A deterministic stand-in for an embedding model that makes paraphrases land close together: words from the same
 * concept group ("park", "car", "vehicle"...) share a dimension, and every other word is hashed into a few extra dimensions so
 * unrelated texts stay far apart. It lets the suite exercise paraphrase retrieval without calling any model. It is not semantic
 * understanding and is never registered as a real provider.
 */
const CONCEPTS: string[][] = [
  ['park', 'parking', 'car', 'vehicle', 'drive', 'driving', 'garage', 'space'],
  ['open', 'opening', 'close', 'closing', 'hour', 'time', 'late', 'early', 'schedule'],
  ['deliver', 'delivery', 'courier', 'ship', 'send', 'bring', 'dispatch', 'drop'],
  ['vegan', 'plant', 'dairy', 'vegetarian', 'meatless'],
  ['price', 'cost', 'much', 'fee', 'pay', 'charge', 'dollar', 'cheap', 'expensive'],
  ['wedding', 'birthday', 'celebration', 'party', 'cake', 'event'],
  ['allergy', 'allergen', 'gluten', 'wheat', 'nut', 'sesame', 'intolerant', 'coeliac'],
  ['refund', 'cancel', 'cancellation', 'return', 'money', 'deposit'],
  ['address', 'location', 'find', 'where', 'street', 'directions'],
];
const HASH_DIMS = 16;

function hashWord(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) { h ^= word.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % HASH_DIMS;
}

export class ConceptEmbedder implements EmbeddingProvider {
  readonly id = 'concept-test';
  readonly model = 'concept-test-v1';
  readonly dimensions = CONCEPTS.length + HASH_DIMS;
  calls: Array<{ kind: EmbeddingInputKind; count: number }> = [];

  async embed(texts: string[], kind: EmbeddingInputKind): Promise<number[][]> {
    this.calls.push({ kind, count: texts.length });
    return texts.map((t) => this.vectorOf(t));
  }

  vectorOf(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const raw = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2);
    for (const word of raw) {
      const forms = [word, word.replace(/s$/, ''), word.replace(/(ing|ed)$/, ''), word.replace(/es$/, '')];
      const concept = CONCEPTS.findIndex((group) => group.some((g) => forms.includes(g)));
      if (concept >= 0) v[concept] += 2;
    }
    for (const term of contentTerms(text)) v[CONCEPTS.length + hashWord(term)] += 0.3;
    return normalizeVector(v);
  }
}
