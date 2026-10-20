import { randomBytes } from 'crypto';

export const WEBHOOK_SECRET_PREFIX = 'whsec_';
const SECRET_BYTES = 32; // 256 bits from the OS CSPRNG

/** A new random signing secret. Shown to the user once; never derived from anything guessable. */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
}

/** A user-chosen secret must be long enough to be a secret and safe to send in an HTTP header. */
export function isAcceptableManualSecret(value: string): boolean {
  return value.length >= 16 && value.length <= 256 && /^[\x21-\x7E]+$/.test(value);
}
