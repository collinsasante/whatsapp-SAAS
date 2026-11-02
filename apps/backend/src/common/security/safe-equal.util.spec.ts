import { secretsMatch } from './safe-equal.util';

describe('secretsMatch', () => {
  it('matches identical secrets', () => {
    expect(secretsMatch('s3cret-value', 's3cret-value')).toBe(true);
  });

  it.each([
    ['a different secret of the same length', 's3cret-valuX', 's3cret-value'],
    ['a prefix of the secret', 's3cret', 's3cret-value'],
    ['a longer value that starts with the secret', 's3cret-value-and-more', 's3cret-value'],
    ['different case', 'S3CRET-VALUE', 's3cret-value'],
    ['surrounding whitespace', ' s3cret-value ', 's3cret-value'],
  ])('rejects %s', (_label, supplied, expected) => {
    expect(secretsMatch(supplied, expected)).toBe(false);
  });

  it.each([
    ['both empty', '', ''],
    ['both missing', undefined, undefined],
    ['supplied missing', undefined, 's3cret-value'],
    ['supplied empty', '', 's3cret-value'],
    ['expected empty (secret not configured)', 'anything', ''],
    ['expected missing (secret not configured)', 'anything', undefined],
    ['expected null', 'anything', null],
  ])('rejects when %s: an unset secret never admits', (_label, supplied, expected) => {
    expect(secretsMatch(supplied as string | undefined, expected as string | undefined | null)).toBe(false);
  });
});
