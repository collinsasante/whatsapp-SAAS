import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Constant-time comparison; an empty or missing value on either side never matches. */
export function internalKeyMatches(supplied: string | undefined, expected: string | undefined): boolean {
  if (!supplied || !expected) return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Service-to-service auth for every route except /health (mounted after it). Fails CLOSED: when the key is not configured the
 * service refuses all requests with 503 rather than accepting every caller on the network. The key is never logged.
 */
export function createRequireInternalKey(expectedKey: string | undefined) {
  return function requireInternalKey(req: Request, res: Response, next: NextFunction): void {
    if (!expectedKey) {
      res.status(503).json({ error: 'Internal service authentication is not configured' });
      return;
    }
    if (!internalKeyMatches(req.header('x-internal-api-key'), expectedKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
