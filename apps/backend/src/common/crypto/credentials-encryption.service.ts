import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
  parseEncryptionKey,
} from './credentials-encryption.util';

/**
 * Field-level encryption for connection credentials at rest (WhatsApp/
 * channel access tokens, bot tokens).
 *
 * Transparently a no-op until CREDENTIALS_ENCRYPTION_KEY is actually set on
 * the server -- deploying this code changes zero runtime behavior for any
 * tenant until that key is generated and configured (a separate, manual
 * step; see infra docs). This is deliberate: every tenant's WhatsApp sending
 * depends on credentials continuing to resolve correctly, so this ships
 * ahead of the key existing rather than requiring both to land atomically
 * on a live system.
 *
 * decrypt() passes through any value that isn't `enc:v1:`-prefixed
 * unchanged (legacy plaintext, or encryption still inactive) -- so
 * encrypted and not-yet-encrypted rows can coexist in the same table during
 * rollout. See scripts/encrypt-existing-credentials.ts for the one-off
 * backfill that switches existing plaintext rows over once the key is live
 * -- it shares this exact same crypto implementation via
 * credentials-encryption.util.ts rather than reimplementing it.
 */
@Injectable()
export class CredentialsEncryptionService {
  private readonly logger = new Logger(CredentialsEncryptionService.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('CREDENTIALS_ENCRYPTION_KEY');
    this.key = parseEncryptionKey(raw);
    if (raw && !this.key) {
      this.logger.error(
        'CREDENTIALS_ENCRYPTION_KEY is set but is not a valid 32-byte base64 value -- encryption disabled, credentials will be read/written as plaintext until this is fixed.',
      );
    }
  }

  /** Whether a real key is configured -- encrypt()/decrypt() are only doing real work if this is true. */
  get isActive(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    return encryptCredential(plaintext, this.key);
  }

  decrypt(value: string | null | undefined): string {
    return decryptCredential(value, this.key);
  }

  /** True if the given stored value is already in encrypted form. */
  isEncrypted(value: string | null | undefined): boolean {
    return isEncryptedCredential(value);
  }
}
