import * as crypto from 'crypto';

/**
 * Verifies Meta's x-hub-signature-256 header against the app secret.
 * Returns true only when a secret is configured AND the signature matches --
 * callers decide fail-open vs fail-closed behavior for the "no secret
 * configured" case, since that differs by call site (see whatsapp.webhook.controller.ts).
 */
export function verifyWhatsAppSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !rawBody || !signatureHeader?.startsWith('sha256=')) return false;

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);

  if (!/^[0-9a-f]+$/i.test(provided) || provided.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

export type WebhookSignatureCheck = 'valid' | 'invalid' | 'unconfigured';

/**
 * Separates "no secret configured" from "a secret is configured and the signature is wrong". A wrong signature must
 * always be rejected; what to do when nothing is configured is the caller's decision.
 */
export function checkWebhookSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, appSecret: string | undefined): WebhookSignatureCheck {
  if (!appSecret) return 'unconfigured';
  return verifyWhatsAppSignature(rawBody, signatureHeader, appSecret) ? 'valid' : 'invalid';
}
