import { createHash, timingSafeEqual } from 'crypto';

/**
 * Compares two secrets in constant time regardless of their lengths. Both sides are hashed first, so timingSafeEqual always gets
 * equal-length buffers and neither the length nor the content of the expected secret can be probed through response timing.
 * An empty or missing value on either side never matches: an unset secret must reject, never admit.
 */
export function secretsMatch(supplied: string | undefined | null, expected: string | undefined | null): boolean {
  if (!supplied || !expected) return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
