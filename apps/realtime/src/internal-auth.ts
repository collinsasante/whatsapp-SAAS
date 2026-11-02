import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

function secretsMatch(supplied: string | undefined, expected: string | undefined): boolean {
  if (!supplied || !expected) return false;
  return timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest());
}

/**
 * Guards /internal/emit, which can push an event to every connected user of any workspace. Fails CLOSED: with no INTERNAL_SECRET
 * configured every call is refused (503); a missing, empty or wrong x-internal-secret is refused (401). Never logs the secret.
 */
export function createRequireInternalSecret(expectedSecret: string | undefined) {
  return function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
    if (!expectedSecret) {
      res.status(503).json({ error: 'Internal service authentication is not configured' });
      return;
    }
    if (!secretsMatch(req.header('x-internal-secret'), expectedSecret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
