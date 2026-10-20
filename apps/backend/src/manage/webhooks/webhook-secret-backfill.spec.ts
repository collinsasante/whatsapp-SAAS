import { randomBytes } from 'crypto';
import { decryptCredential, encryptCredential, isEncryptedCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';
import { backfillWebhookSecrets, BackfillStore } from './webhook-secret-backfill';

const RAW_KEY = randomBytes(32).toString('base64');
const KEY = parseEncryptionKey(RAW_KEY);

function store(rows: Array<{ id: string; tenantId: string; secret: string }>, opts: { raceOn?: string } = {}) {
  const data = new Map(rows.map((r) => [r.id, { ...r }]));
  const s: BackfillStore & { data: typeof data; writes: number } = {
    data, writes: 0,
    findPlaintext: async () => [...data.values()].map((r) => ({ ...r })),
    replaceSecret: async (id, expected, next) => {
      if (opts.raceOn === id) data.get(id)!.secret = 'edited-by-someone-else-123456'; // changed after we read it
      const row = data.get(id)!;
      if (row.secret !== expected) return false;
      row.secret = next; s.writes++; return true;
    },
  };
  return s;
}
const rows = [
  { id: 'w1', tenantId: 'tA', secret: 'plain-secret-one-123456' },
  { id: 'w2', tenantId: 'tA', secret: 'plain-secret-two-123456' },
  { id: 'w3', tenantId: 'tB', secret: encryptCredential('already-protected-123456', KEY) },
];

describe('backfillWebhookSecrets', () => {
  it('dry run reports what it would do and writes nothing', async () => {
    const s = store(rows);
    const r = await backfillWebhookSecrets(s, RAW_KEY, false);
    expect(r).toMatchObject({ scanned: 3, alreadyEncrypted: 1, toEncrypt: 2, encrypted: 0, perTenant: { tA: 2 } });
    expect(s.writes).toBe(0);
    expect(s.data.get('w1')!.secret).toBe('plain-secret-one-123456');
  });

  it('apply encrypts only the plaintext ones, and each decrypts back to the original', async () => {
    const s = store(rows);
    const r = await backfillWebhookSecrets(s, RAW_KEY, true);
    expect(r).toMatchObject({ toEncrypt: 2, encrypted: 2, changedConcurrently: 0 });
    for (const id of ['w1', 'w2']) expect(isEncryptedCredential(s.data.get(id)!.secret)).toBe(true);
    expect(decryptCredential(s.data.get('w1')!.secret, KEY)).toBe('plain-secret-one-123456');
    expect(decryptCredential(s.data.get('w2')!.secret, KEY)).toBe('plain-secret-two-123456');
    expect(s.data.get('w3')!.secret).toBe(rows[2]!.secret); // untouched
  });

  it('is idempotent: a second run finds nothing to do and writes nothing', async () => {
    const s = store(rows);
    await backfillWebhookSecrets(s, RAW_KEY, true);
    const writesAfterFirst = s.writes;
    const again = await backfillWebhookSecrets(s, RAW_KEY, true);
    expect(again).toMatchObject({ toEncrypt: 0, encrypted: 0, alreadyEncrypted: 3 });
    expect(s.writes).toBe(writesAfterFirst);
  });

  it('does not overwrite a secret that was edited while the script ran', async () => {
    const s = store(rows, { raceOn: 'w1' });
    const r = await backfillWebhookSecrets(s, RAW_KEY, true);
    expect(r).toMatchObject({ encrypted: 1, changedConcurrently: 1 });
    expect(s.data.get('w1')!.secret).toBe('edited-by-someone-else-123456');
  });

  it.each([undefined, '', 'not-base64-of-32-bytes', Buffer.from('short').toString('base64')])('refuses to run without a valid key (%j), so plaintext is never rewritten as "encrypted"', async (badKey) => {
    const s = store(rows);
    await expect(backfillWebhookSecrets(s, badKey, true)).rejects.toThrow('Refusing to run');
    expect(s.writes).toBe(0);
  });

  it('the report never contains a secret value', async () => {
    const r = await backfillWebhookSecrets(store(rows), RAW_KEY, true);
    expect(JSON.stringify(r)).not.toMatch(/plain-secret|already-protected/);
  });
});
