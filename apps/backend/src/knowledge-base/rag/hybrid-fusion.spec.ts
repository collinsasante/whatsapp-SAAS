import { reciprocalRankFusion } from './hybrid-fusion';

describe('reciprocalRankFusion', () => {
  it('ranks an item found by both lists above items found by one', () => {
    const fused = reciprocalRankFusion([
      { name: 'keyword', weight: 1, keys: ['a', 'b', 'c'] },
      { name: 'vector', weight: 1, keys: ['d', 'b', 'e'] },
    ]);
    expect(fused[0].key).toBe('b');
    expect(fused[0].ranks).toEqual({ keyword: 2, vector: 2 });
  });

  it('keeps an item that only one list found, ahead of that list\'s weaker items', () => {
    const keys = reciprocalRankFusion([
      { name: 'keyword', weight: 1, keys: ['solo', 'x', 'y'] },
      { name: 'vector', weight: 1, keys: ['q', 'r'] },
    ]).map((f) => f.key);
    expect(keys).toContain('solo');
    expect(keys.indexOf('solo')).toBeLessThan(keys.indexOf('x'));
    expect(keys.indexOf('solo')).toBeLessThan(keys.indexOf('y'));
  });

  it('applies the list weights', () => {
    const heavyVector = reciprocalRankFusion([{ name: 'keyword', weight: 1, keys: ['k'] }, { name: 'vector', weight: 3, keys: ['v'] }]);
    expect(heavyVector[0].key).toBe('v');
    const zeroVector = reciprocalRankFusion([{ name: 'keyword', weight: 1, keys: ['k'] }, { name: 'vector', weight: 0, keys: ['v'] }]);
    expect(zeroVector[0].key).toBe('k');
  });

  it('is deterministic on ties and ignores a repeated key within one list', () => {
    const a = reciprocalRankFusion([{ name: 'keyword', weight: 1, keys: ['b', 'a'] }, { name: 'vector', weight: 1, keys: ['a', 'b'] }]);
    const b = reciprocalRankFusion([{ name: 'keyword', weight: 1, keys: ['b', 'a'] }, { name: 'vector', weight: 1, keys: ['a', 'b'] }]);
    expect(a).toEqual(b);
    expect(a.map((x) => x.key)).toEqual(['a', 'b']);
    expect(reciprocalRankFusion([{ name: 'keyword', weight: 1, keys: ['a', 'a', 'b'] }]).map((x) => x.key)).toEqual(['a', 'b']);
  });

  it('returns nothing for no input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
