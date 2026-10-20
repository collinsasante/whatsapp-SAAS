import { encryptCredential, isEncryptedCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';

export interface BackfillStore {
  findPlaintext(): Promise<Array<{ id: string; tenantId: string; secret: string }>>;
  /** Writes only if the stored value is still exactly `expected` (compare-and-set). Returns whether it wrote. */
  replaceSecret(id: string, expected: string, next: string): Promise<boolean>;
}

export interface BackfillReport {
  scanned: number;
  alreadyEncrypted: number;
  toEncrypt: number;
  encrypted: number;
  changedConcurrently: number;
  perTenant: Record<string, number>;
}

/**
 * Encrypts webhook secrets that were stored as plaintext before secrets were encrypted at rest.
 * - Dry run by default: reports counts and writes nothing.
 * - Idempotent: values already carrying the enc:v1: prefix are left alone, so it is safe to run twice.
 * - Compare-and-set: a secret edited while the script runs is not overwritten.
 * - Never prints a secret. Output is counts and workspace ids only.
 * - Refuses to run without a valid 32-byte key: encrypting with no key would write the plaintext back unchanged.
 */
export async function backfillWebhookSecrets(store: BackfillStore, rawKey: string | undefined, apply: boolean): Promise<BackfillReport> {
  const key = parseEncryptionKey(rawKey);
  if (!key) throw new Error('CREDENTIALS_ENCRYPTION_KEY is missing or is not a valid 32-byte base64 value. Refusing to run.');

  const rows = await store.findPlaintext();
  const report: BackfillReport = { scanned: rows.length, alreadyEncrypted: 0, toEncrypt: 0, encrypted: 0, changedConcurrently: 0, perTenant: {} };

  for (const row of rows) {
    if (!row.secret) continue;
    if (isEncryptedCredential(row.secret)) { report.alreadyEncrypted++; continue; }
    report.toEncrypt++;
    report.perTenant[row.tenantId] = (report.perTenant[row.tenantId] ?? 0) + 1;
    if (!apply) continue;
    const wrote = await store.replaceSecret(row.id, row.secret, encryptCredential(row.secret, key));
    if (wrote) report.encrypted++; else report.changedConcurrently++;
  }
  return report;
}
