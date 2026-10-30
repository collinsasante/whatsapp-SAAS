import { extractFeatures } from '../message-features.util';

/** Everything the validation looks at in one AI reply. Derived from the same deterministic extractor the learner uses. */
export interface StyleMetrics {
  words: number;
  emoji: boolean;
  exclaim: boolean;
  endsWithQuestion: boolean;
  formalMarkers: number;
  casualMarkers: number;
}

export function measureReply(reply: string): StyleMetrics | null {
  const f = extractFeatures(reply);
  return f && { words: f.words, emoji: f.hasEmoji, exclaim: f.hasExclaim, endsWithQuestion: f.endsWithQuestion, formalMarkers: f.formalMarkers, casualMarkers: f.casualMarkers };
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const rate = (xs: boolean[]): number => mean(xs.map((x) => (x ? 1 : 0)));

export interface StyleComparison {
  /** The dimensions on which the two agents' replies clearly differ. */
  differing: string[];
  distinguishable: boolean;
}

/** Fewest differing dimensions for two sets of replies to count as "distinguishable". One dimension alone is too easily luck. */
export const MIN_DIFFERING_DIMENSIONS = 2;

/** Compares the average style of two agents' replies (several replies each, to damp the noise of any single one). */
export function compareStyles(a: StyleMetrics[], b: StyleMetrics[]): StyleComparison {
  const differing: string[] = [];
  const [wa, wb] = [mean(a.map((m) => m.words)), mean(b.map((m) => m.words))];
  if (Math.max(wa, wb) / Math.max(1, Math.min(wa, wb)) >= 1.5) differing.push('length');
  if (Math.abs(rate(a.map((m) => m.emoji)) - rate(b.map((m) => m.emoji))) >= 0.5) differing.push('emoji');
  if (Math.abs(rate(a.map((m) => m.exclaim)) - rate(b.map((m) => m.exclaim))) >= 0.5) differing.push('energy');
  if (Math.abs(rate(a.map((m) => m.endsWithQuestion)) - rate(b.map((m) => m.endsWithQuestion))) >= 0.5) differing.push('follow-up questions');
  const register = (ms: StyleMetrics[]) => mean(ms.map((m) => m.formalMarkers)) - mean(ms.map((m) => m.casualMarkers));
  if (Math.abs(register(a) - register(b)) >= 1) differing.push('formality');
  return { differing, distinguishable: differing.length >= MIN_DIFFERING_DIMENSIONS };
}

const MONEY = /(?:GH[₵S]|GHS|₵|\$|USD|NGN|₦|€|£)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:GHS|cedis?|USD|dollars?)\b/gi;

/** "GH₵ 1,050.00" and "ghs1050" are the same price. */
export const normalizeMoney = (token: string): string => token.replace(/\s+/g, '').replace(/,/g, '').replace(/\.00$/, '').toUpperCase().replace('GHS', 'GH₵');

export function priceTokens(text: string): string[] {
  return (text.match(MONEY) ?? []).map(normalizeMoney);
}

export interface FactRules {
  mustContain: string[];
  mustNotContain: string[];
  /** Every price that may appear in a reply. A price-looking token that is not listed is treated as invented. */
  allowedPrices: string[];
}

/** Problems with one reply's facts; empty means it passed. Case-insensitive for words, normalised for prices. */
export function checkFacts(reply: string, rules: FactRules): string[] {
  const problems: string[] = [];
  const lower = reply.toLowerCase();
  const found = new Set(priceTokens(reply));
  for (const needed of rules.mustContain) {
    // A required price is compared by value, so "GH₵ 50.00" satisfies "GH₵50": a style may format a correct price differently.
    const asPrice = priceTokens(needed);
    const present = asPrice.length === 1 && normalizeMoney(needed) === asPrice[0] ? found.has(asPrice[0]!) : lower.includes(needed.toLowerCase());
    if (!present) problems.push(`missing "${needed}"`);
  }
  for (const banned of rules.mustNotContain) if (lower.includes(banned.toLowerCase())) problems.push(`contains forbidden "${banned}"`);
  const allowed = new Set(rules.allowedPrices.map(normalizeMoney));
  for (const price of priceTokens(reply)) if (!allowed.has(price)) problems.push(`price not in the catalogue: ${price}`);
  return problems;
}
