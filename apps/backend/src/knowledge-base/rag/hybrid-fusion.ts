/**
 * Reciprocal Rank Fusion: combines several ranked lists without having to make their scores comparable (a keyword score and a cosine
 * similarity are not). An item scores weight / (k + rank) in each list it appears in, summed. Items found by several retrievers rise;
 * a single strong match in one list still survives. Deterministic: ties break on best single rank, then key.
 */
export interface RankedList {
  name: string;
  weight: number;
  /** Best first. */
  keys: string[];
}

export interface FusedItem {
  key: string;
  score: number;
  /** 1-based rank in each list that contained the item. */
  ranks: Record<string, number>;
}

export function reciprocalRankFusion(lists: RankedList[], k = 60): FusedItem[] {
  const fused = new Map<string, FusedItem>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.keys.forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      const rank = seen.size;
      const item = fused.get(key) ?? { key, score: 0, ranks: {} };
      item.score += list.weight / (k + rank);
      item.ranks[list.name] = rank;
      fused.set(key, item);
    });
  }
  const best = (i: FusedItem) => Math.min(...Object.values(i.ranks));
  return [...fused.values()].sort((a, b) => b.score - a.score || best(a) - best(b) || a.key.localeCompare(b.key));
}
