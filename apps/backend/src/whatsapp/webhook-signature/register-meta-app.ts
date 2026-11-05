import * as crypto from 'crypto';
import { encryptCredential, isEncryptedCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';

export interface RegistryDb {
  upsertApp(appId: string, data: { label: string; status: string; secretEnc: string; secretFingerprint: string }): Promise<{ id: string }>;
  ownsWaba(tenantId: string, wabaId: string): Promise<boolean>;
  mapWaba(tenantId: string, wabaId: string, metaAppId: string): Promise<void>;
}

export interface RegisterInput {
  appId: string;
  label: string;
  secret: string;
  /** "tenantId:wabaId" pairs. */
  mappings: string[];
  encryptionKey: string | undefined;
}

/**
 * Registers (or updates) one Meta app and its WABA mappings from the command line. The secret arrives as an argument of THIS FUNCTION only (the CLI reads it
 * from a hidden prompt or stdin, never from argv), is encrypted before it touches the database, and is never part of the returned report.
 */
export async function registerMetaApp(db: RegistryDb, input: RegisterInput) {
  if (!/^\d{5,25}$/.test(input.appId)) throw new Error('appId must be the numeric Meta app id');
  if (!input.label.trim() || input.label.length > 80) throw new Error('label must be 1 to 80 characters');
  if (input.secret.length < 16 || input.secret.length > 128 || /\s/.test(input.secret)) throw new Error('the secret must be 16 to 128 characters without whitespace');
  const key = parseEncryptionKey(input.encryptionKey);
  if (!key) throw new Error('CREDENTIALS_ENCRYPTION_KEY is missing or not a valid 32-byte base64 value: refusing to store a secret unencrypted');
  const pairs = input.mappings.map((m) => {
    const [tenantId, wabaId, ...rest] = m.split(':');
    if (!tenantId || !wabaId || rest.length > 0 || !/^\d{5,25}$/.test(wabaId)) throw new Error(`mapping "${m}" must look like tenantId:wabaId`);
    return { tenantId, wabaId };
  });
  for (const p of pairs) if (!(await db.ownsWaba(p.tenantId, p.wabaId))) throw new Error(`tenant ${p.tenantId} has no WhatsApp number on WABA …${p.wabaId.slice(-4)}`);

  const secretEnc = encryptCredential(input.secret, key);
  if (!isEncryptedCredential(secretEnc)) throw new Error('encryption did not produce an encrypted value; nothing was stored');
  const fingerprint = crypto.createHash('sha256').update(input.secret).digest('hex').slice(0, 8);
  const row = await db.upsertApp(input.appId, { label: input.label.trim(), status: 'ACTIVE', secretEnc, secretFingerprint: fingerprint });
  for (const p of pairs) await db.mapWaba(p.tenantId, p.wabaId, row.id);
  return { appId: input.appId, label: input.label.trim(), secretFingerprint: fingerprint, mappingsApplied: pairs.length };
}
