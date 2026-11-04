import * as crypto from 'crypto';
import { decryptCredential, encryptCredential, isEncryptedCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';

/**
 * Moves every stored credential between plaintext and `enc:v1:` ciphertext (AES-256-GCM, the same primitives the application uses).
 *
 *  - mode 'encrypt': plaintext values become ciphertext; values already carrying the prefix are left alone (idempotent).
 *  - mode 'decrypt': the rollback; ciphertext becomes plaintext; plaintext is left alone.
 *
 * Safety properties (each covered by a test):
 *  - Dry run unless `apply` is true; a dry run writes nothing.
 *  - Refuses to run without a valid 32-byte key (encrypting with no key would write the plaintext back unchanged).
 *  - KEY CHECK FIRST: before any write, every value that is already ciphertext must decrypt with the supplied key; one failure aborts the whole run
 *    with nothing written, so a wrong key can never be applied on top of data encrypted with the right one.
 *  - Compare-and-set per row: a value changed by the application while the tool runs is not overwritten (counted as `changedConcurrently`).
 *  - Verification pass after apply: re-reads everything and confirms the target state (and that ciphertext decrypts).
 *  - Output is counts and target names only. No value, no id, no tenant id is ever put in the report or an error message.
 */
export type ReencryptionMode = 'encrypt' | 'decrypt';

/** One credential-bearing location. `raw` is the stored value as the database returns it (string, JSON object or null). */
export interface CredentialRow { id: string; raw: unknown }

export interface CredentialTarget {
  /** table.column, for the report only */
  name: string;
  /** For JSON columns, the top-level string fields that hold credentials. Empty for plain string columns. */
  jsonFields: readonly string[];
  /** Keyset pagination: rows with id greater than `afterId`, ordered by id, at most `take`. */
  list(afterId: string | null, take: number): Promise<CredentialRow[]>;
  /** Writes `next` only if the stored value still equals `expected`. Returns whether it wrote. */
  replace(id: string, expected: unknown, next: unknown): Promise<boolean>;
}

export interface TargetReport {
  scanned: number;
  empty: number;
  alreadyInTargetState: number;
  toChange: number;
  changed: number;
  changedConcurrently: number;
  /** values that are ciphertext but do not decrypt with this key (key check) */
  undecryptable: number;
}

export interface ReencryptionReport {
  mode: ReencryptionMode;
  applied: boolean;
  keyFingerprint: string;
  aborted?: string;
  targets: Record<string, TargetReport>;
  verification?: { ok: boolean; failures: number };
}

export const DEFAULT_BATCH = 200;

export function keyFingerprint(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

const emptyReport = (): TargetReport => ({ scanned: 0, empty: 0, alreadyInTargetState: 0, toChange: 0, changed: 0, changedConcurrently: 0, undecryptable: 0 });

type Visit = (value: string) => void;

/** Calls `visit` for every credential string in the raw value (the string itself, or the listed fields of a JSON object). */
function eachCredential(target: CredentialTarget, raw: unknown, visit: Visit): void {
  if (target.jsonFields.length === 0) {
    if (typeof raw === 'string') visit(raw);
    return;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const f of target.jsonFields) {
      const v = (raw as Record<string, unknown>)[f];
      if (typeof v === 'string') visit(v);
    }
  }
}

function transformString(value: string, mode: ReencryptionMode, key: Buffer): string | null {
  if (!value) return null;
  const encrypted = isEncryptedCredential(value);
  if (mode === 'encrypt') return encrypted ? null : encryptCredential(value, key);
  return encrypted ? decryptCredential(value, key) : null;
}

/** Returns the new raw value, or null when nothing in it needs to change. Also tallies the row into `report`. */
function transformRaw(target: CredentialTarget, raw: unknown, mode: ReencryptionMode, key: Buffer, report: TargetReport): unknown | null {
  let sawCredential = false;
  let changedAny = false;
  let next: unknown = raw;

  if (target.jsonFields.length === 0) {
    if (typeof raw === 'string') {
      sawCredential = !!raw;
      const t = transformString(raw, mode, key);
      if (t !== null) { next = t; changedAny = true; }
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    for (const f of target.jsonFields) {
      const v = copy[f];
      if (typeof v !== 'string' || !v) continue;
      sawCredential = true;
      const t = transformString(v, mode, key);
      if (t !== null) { copy[f] = t; changedAny = true; }
    }
    next = copy;
  }

  if (!sawCredential) report.empty++;
  else if (changedAny) report.toChange++;
  else report.alreadyInTargetState++;
  return changedAny ? next : null;
}

async function* walk(target: CredentialTarget, batch: number): AsyncGenerator<CredentialRow> {
  let after: string | null = null;
  for (;;) {
    const rows: CredentialRow[] = await target.list(after, batch);
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    after = rows[rows.length - 1]!.id;
    if (rows.length < batch) return;
  }
}

export async function reencryptCredentials(
  targets: readonly CredentialTarget[],
  rawKey: string | undefined,
  opts: { mode: ReencryptionMode; apply: boolean; batch?: number },
): Promise<ReencryptionReport> {
  const key = parseEncryptionKey(rawKey);
  if (!key) throw new Error('CREDENTIALS_ENCRYPTION_KEY is missing or is not a valid 32-byte base64 value. Refusing to run.');
  const batch = opts.batch ?? DEFAULT_BATCH;
  const report: ReencryptionReport = { mode: opts.mode, applied: false, keyFingerprint: keyFingerprint(key), targets: {} };
  for (const t of targets) report.targets[t.name] = emptyReport();

  // 1. KEY CHECK: every existing ciphertext must open with this key, before anything is written.
  let undecryptable = 0;
  for (const t of targets) {
    const r = report.targets[t.name]!;
    for await (const row of walk(t, batch)) {
      eachCredential(t, row.raw, (v) => {
        if (!isEncryptedCredential(v)) return;
        try { decryptCredential(v, key); } catch { r.undecryptable++; undecryptable++; }
      });
    }
  }
  if (undecryptable > 0) {
    report.aborted = `${undecryptable} stored value(s) are encrypted but do not open with this key (fingerprint ${report.keyFingerprint}). Nothing was written.`;
    return report;
  }

  // 2. Plan (dry run) or apply.
  for (const t of targets) {
    const r = report.targets[t.name]!;
    r.empty = r.alreadyInTargetState = r.toChange = 0;
    for await (const row of walk(t, batch)) {
      r.scanned++;
      const next = transformRaw(t, row.raw, opts.mode, key, r);
      if (next === null || !opts.apply) continue;
      if (await t.replace(row.id, row.raw, next)) r.changed++; else r.changedConcurrently++;
    }
  }
  report.applied = opts.apply;

  // 3. Verification after apply.
  if (opts.apply) {
    let failures = 0;
    for (const t of targets) {
      for await (const row of walk(t, batch)) {
        eachCredential(t, row.raw, (v) => {
          if (!v) return;
          const enc = isEncryptedCredential(v);
          if (opts.mode === 'encrypt') {
            if (!enc) { failures++; return; }
            try { decryptCredential(v, key); } catch { failures++; }
          } else if (enc) failures++;
        });
      }
    }
    report.verification = { ok: failures === 0, failures };
  }
  return report;
}
