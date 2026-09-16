import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
export const ENCRYPTION_VERSION_PREFIX = 'enc:v1:';

/**
 * Pure crypto functions, deliberately free of any NestJS DI so both
 * CredentialsEncryptionService (the app-runtime wrapper, key resolved via
 * ConfigService) and scripts/encrypt-existing-credentials.ts (a standalone
 * one-off backfill script, key resolved via process.env directly) call the
 * exact same encrypt/decrypt implementation -- never worth risking two
 * independent AES-GCM implementations drifting apart.
 */

export function parseEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function isEncryptedCredential(value: string | null | undefined): boolean {
  return !!value && value.startsWith(ENCRYPTION_VERSION_PREFIX);
}

export function encryptCredential(plaintext: string, key: Buffer | null): string {
  if (!key) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENCRYPTION_VERSION_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptCredential(value: string | null | undefined, key: Buffer | null): string {
  if (!value) return '';
  if (!isEncryptedCredential(value)) return value;

  if (!key) {
    // An encrypted value exists but we have no key to open it. Fail loudly
    // here rather than silently handing ciphertext to a caller that would
    // use it as a bearer token -- that would surface as a confusing Meta
    // API auth failure far from the real cause.
    throw new Error('Cannot decrypt credential: an encrypted value was found but no valid encryption key is configured.');
  }

  const raw = Buffer.from(value.slice(ENCRYPTION_VERSION_PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
