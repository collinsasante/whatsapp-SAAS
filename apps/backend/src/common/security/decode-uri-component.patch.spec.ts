import { createRequire } from 'module';

// Resolve decode-uri-component the way a real consumer does (minio -> query-string@7 -> decode-uri-component), so the
// spec exercises the patched copy that ships (patches/decode-uri-component@0.2.2.patch) and not some other version.
const fromQueryString = createRequire(require.resolve('query-string'));
const decode = fromQueryString('decode-uri-component') as (s: string) => string;

describe('patched decode-uri-component (GHSA-vcc3-ghjq-m6fr, GHSA-qr28-fpjm-wq7f)', () => {
  it('is the 0.2.2 entry point that query-string@7 can still require()', () => {
    expect(typeof decode).toBe('function');
    expect(fromQueryString('decode-uri-component/package.json').version).toBe('0.2.2');
  });

  describe('well-formed input is unchanged', () => {
    it.each([
      ['plain text', 'hello', 'hello'],
      ['plus becomes a space', 'a+b', 'a b'],
      ['ASCII escapes', 'a%20b%2Fc', 'a b/c'],
      ['multi-byte UTF-8', '%E2%82%AC%F0%9F%98%80', '€😀'],
      ['empty string', '', ''],
    ])('%s', (_label, input, expected) => {
      expect(decode(input)).toBe(expected);
    });
  });

  describe('malformed input is decoded as far as possible, never thrown', () => {
    it.each([
      ['lone percent', '100%', '100%'],
      ['truncated escape', 'a%2', 'a%2'],
      ['non-hex escape', 'a%zzb', 'a%zzb'],
      ['invalid lead byte kept literally', '%FFabc', '%FFabc'],
      ['stray continuation byte kept literally', '%80ok', '%80ok'],
      ['valid parts around an invalid one', '%41%FF%42', 'A%FFB'],
      ['truncated multi-byte sequence', '%E2%82', '%E2%82'],
      ['a valid sequence after a broken one', '%E2%E2%82%AC', '%E2€'],
    ])('%s', (_label, input, expected) => {
      expect(decode(input)).toBe(expected);
    });

    it('rejects non-string input', () => {
      expect(() => decode(undefined as unknown as string)).toThrow(TypeError);
    });
  });

  describe('large hostile input is handled in linear time', () => {
    // Upstream 0.2.2 takes seconds to minutes on these; a linear pass takes milliseconds. The bound is generous
    // so a slow CI machine does not flake, while still failing by orders of magnitude on a quadratic decoder.
    const BUDGET_MS = 1500;

    const cases: Array<[string, string]> = [
      ['long run of invalid lead bytes ending in a bad escape', '%FF'.repeat(50_000) + '%'],
      ['alternating valid and invalid escapes', '%41%FF'.repeat(30_000)],
      ['truncated multi-byte sequences repeated', '%E2%82'.repeat(40_000)],
      ['many distinct short runs', Array.from({ length: 20_000 }, (_, i) => `%${(i % 256).toString(16).padStart(2, '0')}x`).join('')],
    ];

    it.each(cases)('%s', (_label, input) => {
      const started = Date.now();
      const out = decode(input);
      expect(typeof out).toBe('string');
      expect(Date.now() - started).toBeLessThan(BUDGET_MS);
    });
  });
});
