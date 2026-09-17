import * as crypto from 'crypto';

export interface OAuthStatePayload {
  tenantId: string;
  provider: string;
  userId: string;
  /** Unix ms timestamp this state expires at. */
  exp: number;
}

const STATE_TTL_MS = 5 * 60_000;

/**
 * Signs an OAuth `state` param server-side, tied to the authenticated user's
 * tenant, so the callback never has to trust a client-suppliable tenantId.
 * Format: base64url(JSON payload) + '.' + hex HMAC-SHA256 of that payload
 * string, verified with a constant-time comparison (mirrors the exact
 * primitive whatsapp/webhook-signature.util.ts already uses for Meta's own
 * webhook signatures).
 */
export function signOAuthState(payload: Pick<OAuthStatePayload, 'tenantId' | 'provider' | 'userId'>, secret: string): string {
  const full: OAuthStatePayload = { ...payload, exp: Date.now() + STATE_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

/**
 * Verifies a state token produced by signOAuthState(). Returns the payload
 * only if the signature matches AND the token hasn't expired; null
 * otherwise (tampered, malformed, wrong secret, or expired) -- callers must
 * never fall back to trusting an unverified state.
 */
export function verifyOAuthState(token: string | undefined, secret: string): OAuthStatePayload | null {
  if (!token) return null;
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex <= 0) return null;

  const encoded = token.slice(0, dotIndex);
  const providedSignature = token.slice(dotIndex + 1);

  const expectedSignature = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  if (!/^[0-9a-f]+$/i.test(providedSignature) || providedSignature.length !== expectedSignature.length) return null;

  let signatureValid: boolean;
  try {
    signatureValid = crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(providedSignature, 'hex'));
  } catch {
    return null;
  }
  if (!signatureValid) return null;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as OAuthStatePayload;
  } catch {
    return null;
  }

  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (typeof payload.tenantId !== 'string' || typeof payload.provider !== 'string' || typeof payload.userId !== 'string') return null;

  return payload;
}
