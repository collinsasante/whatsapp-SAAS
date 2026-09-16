import * as crypto from 'crypto';
import {
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
  parseEncryptionKey,
} from './credentials-encryption.util';

const REAL_KEY = crypto.randomBytes(32);

describe('parseEncryptionKey', () => {
  it('returns null when no value is given', () => {
    expect(parseEncryptionKey(undefined)).toBeNull();
  });

  it('returns null for a value that does not decode to exactly 32 bytes', () => {
    expect(parseEncryptionKey(Buffer.from('too short').toString('base64'))).toBeNull();
  });

  it('returns a 32-byte Buffer for a valid base64-encoded 32-byte key', () => {
    const key = parseEncryptionKey(REAL_KEY.toString('base64'));
    expect(key).not.toBeNull();
    expect(key!.length).toBe(32);
  });
});

describe('encryptCredential / decryptCredential', () => {
  it('is a no-op passthrough when no key is configured -- deploying this code changes nothing until a key exists', () => {
    expect(encryptCredential('plain-token', null)).toBe('plain-token');
  });

  it('round-trips a value through encrypt then decrypt with a real key', () => {
    const ciphertext = encryptCredential('super-secret-token', REAL_KEY);
    expect(ciphertext).not.toBe('super-secret-token');
    expect(decryptCredential(ciphertext, REAL_KEY)).toBe('super-secret-token');
  });

  it('produces different ciphertext for the same plaintext each time (random IV)', () => {
    const a = encryptCredential('same-input', REAL_KEY);
    const b = encryptCredential('same-input', REAL_KEY);
    expect(a).not.toBe(b);
    expect(decryptCredential(a, REAL_KEY)).toBe('same-input');
    expect(decryptCredential(b, REAL_KEY)).toBe('same-input');
  });

  it('passes through a legacy plaintext value unchanged when decrypting, regardless of key state', () => {
    expect(decryptCredential('legacy-plaintext-token', REAL_KEY)).toBe('legacy-plaintext-token');
    expect(decryptCredential('legacy-plaintext-token', null)).toBe('legacy-plaintext-token');
  });

  it('returns an empty string for null/undefined input rather than throwing', () => {
    expect(decryptCredential(null, REAL_KEY)).toBe('');
    expect(decryptCredential(undefined, REAL_KEY)).toBe('');
  });

  it('throws rather than silently returning ciphertext when an encrypted value exists but no key is configured', () => {
    const ciphertext = encryptCredential('secret', REAL_KEY);
    expect(() => decryptCredential(ciphertext, null)).toThrow();
  });

  it('throws rather than silently succeeding when decrypting with the wrong key (auth tag mismatch)', () => {
    const ciphertext = encryptCredential('secret', REAL_KEY);
    const wrongKey = crypto.randomBytes(32);
    expect(() => decryptCredential(ciphertext, wrongKey)).toThrow();
  });
});

describe('isEncryptedCredential', () => {
  it('detects the version-prefixed ciphertext format', () => {
    const ciphertext = encryptCredential('secret', REAL_KEY);
    expect(isEncryptedCredential(ciphertext)).toBe(true);
  });

  it('returns false for plaintext, empty, and nullish values', () => {
    expect(isEncryptedCredential('plain-token')).toBe(false);
    expect(isEncryptedCredential('')).toBe(false);
    expect(isEncryptedCredential(null)).toBe(false);
    expect(isEncryptedCredential(undefined)).toBe(false);
  });
});
