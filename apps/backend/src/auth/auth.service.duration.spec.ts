import { parseDurationToSeconds } from './auth.service';

describe('parseDurationToSeconds', () => {
  it.each([
    ['15m', 15 * 60],
    ['30d', 30 * 86400],
    ['90d', 90 * 86400],
    ['7d', 7 * 86400],
    ['1h', 3600],
    ['45s', 45],
  ])('converts %s to %d seconds', (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected);
  });

  it('falls back to 30 days for an unrecognized value', () => {
    expect(parseDurationToSeconds('garbage')).toBe(30 * 86400);
  });
});
