import { decryptCredential, encryptCredential, isEncryptedCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';
import { CredentialRow, CredentialTarget, reencryptCredentials } from './credential-reencryption';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY_B64 = Buffer.alloc(32, 9).toString('base64');
const KEY = parseEncryptionKey(KEY_B64)!;
const OTHER = parseEncryptionKey(OTHER_KEY_B64)!;
const SECRETS = ['EAAB-wa-token-1', 'EAAB-wa-token-2', 'page-token', '123:telegram-bot', 'pat.airtable', 'legacy-tenant-token'];

/** In-memory table implementing the same compare-and-set contract as the Prisma adapters. */
function memTarget(name: string, rows: Array<{ id: string; raw: unknown }>, jsonFields: string[] = []) {
  const data = rows.map((r) => ({ ...r }));
  const target: CredentialTarget & { data: typeof data; interfere?: (id: string) => void } = {
    name, jsonFields, data,
    async list(afterId, take): Promise<CredentialRow[]> {
      return data.filter((r) => (afterId ? r.id > afterId : true) && r.raw !== null).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, take).map((r) => ({ id: r.id, raw: JSON.parse(JSON.stringify(r.raw)) }));
    },
    async replace(id, expected, next) {
      target.interfere?.(id);
      const row = data.find((r) => r.id === id)!;
      if (JSON.stringify(row.raw) !== JSON.stringify(expected)) return false;
      row.raw = next;
      return true;
    },
  };
  return target;
}
const noSecretsIn = (x: unknown) => { const s = JSON.stringify(x); for (const v of SECRETS) expect(s).not.toContain(v); expect(s).not.toMatch(/enc:v1:/); };

describe('reencryptCredentials', () => {
  it('refuses to run without a valid 32-byte key', async () => {
    for (const bad of [undefined, '', 'short', Buffer.alloc(16).toString('base64')]) await expect(reencryptCredentials([], bad, { mode: 'encrypt', apply: true })).rejects.toThrow('Refusing to run');
  });

  it('dry run reports what would change and writes nothing', async () => {
    const t = memTarget('whatsapp_numbers.access_token', [{ id: 'a', raw: SECRETS[0] }, { id: 'b', raw: encryptCredential(SECRETS[1]!, KEY) }, { id: 'c', raw: '' }]);
    const before = JSON.stringify(t.data);
    const r = await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: false });
    expect(JSON.stringify(t.data)).toBe(before);
    expect(r.applied).toBe(false);
    expect(r.targets['whatsapp_numbers.access_token']).toMatchObject({ scanned: 3, toChange: 1, alreadyInTargetState: 1, empty: 1, changed: 0 });
    noSecretsIn(r);
  });

  it('encrypts plaintext, leaves ciphertext alone, and is idempotent (second run changes nothing)', async () => {
    const already = encryptCredential(SECRETS[1]!, KEY);
    const t = memTarget('x.y', [{ id: 'a', raw: SECRETS[0] }, { id: 'b', raw: already }]);
    const first = await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: true });
    expect(first.targets['x.y']).toMatchObject({ changed: 1, changedConcurrently: 0 });
    expect(first.verification).toEqual({ ok: true, failures: 0 });
    expect(isEncryptedCredential(t.data[0]!.raw as string)).toBe(true);
    expect(decryptCredential(t.data[0]!.raw as string, KEY)).toBe(SECRETS[0]);
    expect(t.data[1]!.raw).toBe(already);                                  // untouched byte for byte
    const second = await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: true });
    expect(second.targets['x.y']).toMatchObject({ toChange: 0, changed: 0, alreadyInTargetState: 2 });
    noSecretsIn(first); noSecretsIn(second);
  });

  it('rollback: decrypt mode restores the exact original plaintext', async () => {
    const t = memTarget('x.y', SECRETS.slice(0, 3).map((s, i) => ({ id: `r${i}`, raw: s })));
    await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: true });
    expect(t.data.every((r) => isEncryptedCredential(r.raw as string))).toBe(true);
    const back = await reencryptCredentials([t], KEY_B64, { mode: 'decrypt', apply: true });
    expect(back.verification).toEqual({ ok: true, failures: 0 });
    expect(t.data.map((r) => r.raw)).toEqual(SECRETS.slice(0, 3));
  });

  it('KEY CHECK: ciphertext that does not open with the supplied key aborts the whole run before anything is written', async () => {
    const good = memTarget('a.b', [{ id: '1', raw: SECRETS[0] }]);
    const wrongKeyRow = memTarget('c.d', [{ id: '1', raw: encryptCredential(SECRETS[1]!, OTHER) }]);
    const r = await reencryptCredentials([good, wrongKeyRow], KEY_B64, { mode: 'encrypt', apply: true });
    expect(r.aborted).toContain('do not open with this key');
    expect(r.targets['c.d']!.undecryptable).toBe(1);
    expect(good.data[0]!.raw).toBe(SECRETS[0]);                            // the good table was NOT encrypted either
    expect(r.applied).toBe(false);
    noSecretsIn(r);
  });

  it('compare-and-set: a value the application changes while the tool runs is not overwritten, is counted, and verification then asks for a re-run', async () => {
    const t = memTarget('x.y', [{ id: 'a', raw: SECRETS[0] }, { id: 'b', raw: SECRETS[1] }]);
    t.interfere = (id) => { if (id === 'a') t.data.find((r) => r.id === 'a')!.raw = 'new-value-written-by-the-app'; };
    const r = await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: true });
    expect(r.targets['x.y']).toMatchObject({ changed: 1, changedConcurrently: 1 });
    expect(t.data[0]!.raw).toBe('new-value-written-by-the-app');           // the app's write survived
    expect(r.verification!.ok).toBe(false);                                // still plaintext: run again
    t.interfere = undefined;
    const again = await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: true });
    expect(again.verification!.ok).toBe(true);
  });

  it('JSON credentials: only the listed fields are touched; identifiers, other keys, mixed states and non-strings are preserved', async () => {
    const alreadyEncryptedRefresh = encryptCredential(SECRETS[1]!, KEY);
    const mixed = { accessToken: SECRETS[0], refreshToken: alreadyEncryptedRefresh, openId: 'open-1', externalId: 'ext-1', scope: 'user.info.basic', botToken: 12345, nested: { accessToken: 'leave-me' } };
    const tg = { botToken: SECRETS[3] };
    const t = memTarget('channels.credentials', [{ id: 'm', raw: mixed }, { id: 'tg', raw: tg }, { id: 'empty', raw: {} }, { id: 'arr', raw: ['x'] }], ['accessToken', 'refreshToken', 'botToken']);
    const r = await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: true });
    expect(r.verification).toEqual({ ok: true, failures: 0 });
    const m = t.data[0]!.raw as Record<string, unknown>;
    expect(decryptCredential(m['accessToken'] as string, KEY)).toBe(SECRETS[0]);
    expect(m['refreshToken']).toBe(alreadyEncryptedRefresh);                // an already-encrypted field is left byte for byte
    expect(decryptCredential(m['refreshToken'] as string, KEY)).toBe(SECRETS[1]);
    expect(m).toMatchObject({ openId: 'open-1', externalId: 'ext-1', scope: 'user.info.basic', botToken: 12345, nested: { accessToken: 'leave-me' } });
    expect(decryptCredential((t.data[1]!.raw as Record<string, string>)['botToken'], KEY)).toBe(SECRETS[3]);
    expect(t.data[2]!.raw).toEqual({}); expect(t.data[3]!.raw).toEqual(['x']);
    expect(r.targets['channels.credentials']).toMatchObject({ scanned: 4, changed: 2, empty: 2 });
  });

  it('paginates through more rows than one batch, every target in order', async () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ id: `id${String(i).padStart(3, '0')}`, raw: `secret-${i}` }));
    const t = memTarget('big.table', rows);
    const r = await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: true, batch: 5 });
    expect(r.targets['big.table']).toMatchObject({ scanned: 23, changed: 23 });
    expect(t.data.every((x) => isEncryptedCredential(x.raw as string))).toBe(true);
  });

  it('the report never contains a value, an id or a ciphertext, and carries only a short key fingerprint', async () => {
    const t = memTarget('x.y', [{ id: 'secret-looking-id-1', raw: SECRETS[0] }]);
    const r = await reencryptCredentials([t], KEY_B64, { mode: 'encrypt', apply: true });
    const s = JSON.stringify(r);
    expect(s).not.toContain('secret-looking-id-1');
    expect(s).not.toContain(SECRETS[0]!);
    expect(s).not.toContain(KEY_B64);
    expect(r.keyFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('buildTargets: what the tool covers', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildTargets } = require('./credential-reencryption.targets') as typeof import('./credential-reencryption.targets');
  const targets = buildTargets({} as never);

  it('covers exactly the eight credential locations', () => {
    expect(targets.map((t) => t.name).sort()).toEqual([
      'channels.credentials', 'facebook_page_connections.page_access_token', 'oauth_connect_sessions.user_access_token', 'tenant_settings.airtable_api_key',
      'tenants.access_token', 'webhooks.secret', 'whatsapp_numbers.access_token', 'whatsapp_web_sessions.encrypted_auth_state',
    ]);
  });
  it('covers every token field kept inside channels.credentials (Instagram/Facebook/TikTok tokens, Telegram bot token and webhook secret)', () => {
    const channels = targets.find((t) => t.name === 'channels.credentials')!;
    expect([...channels.jsonFields].sort()).toEqual(['accessToken', 'botToken', 'refreshToken', 'webhookSecret']);
  });
});
