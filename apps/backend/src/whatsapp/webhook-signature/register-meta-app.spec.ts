import * as crypto from 'crypto';
import { decryptCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';
import { RegistryDb, registerMetaApp } from './register-meta-app';

const KEY = crypto.randomBytes(32).toString('base64');
const SECRET = 'cli-test-secret-' + crypto.randomBytes(10).toString('hex');

function fakeDb(owned: string[] = ['t1:111111']) {
  const apps: Array<{ appId: string; data: Record<string, string> }> = [];
  const maps: Array<{ tenantId: string; wabaId: string; metaAppId: string }> = [];
  const db: RegistryDb = {
    upsertApp: async (appId, data) => { apps.push({ appId, data }); return { id: `row-${appId}` }; },
    ownsWaba: async (t, w) => owned.includes(`${t}:${w}`),
    mapWaba: async (tenantId, wabaId, metaAppId) => { maps.push({ tenantId, wabaId, metaAppId }); },
  };
  return { db, apps, maps };
}
const input = (over: Partial<Parameters<typeof registerMetaApp>[1]> = {}) => ({ appId: '1234567890', label: 'Example', secret: SECRET, mappings: ['t1:111111'], encryptionKey: KEY, ...over });

describe('registerMetaApp (the command-line registration)', () => {
  it('stores the secret encrypted (round-trips with the key), maps the WABA, and reports no secret', async () => {
    const { db, apps, maps } = fakeDb();
    const report = await registerMetaApp(db, input());
    expect(apps[0]!.data['secretEnc']!.startsWith('enc:v1:')).toBe(true);
    expect(JSON.stringify(apps)).not.toContain(SECRET);
    expect(decryptCredential(apps[0]!.data['secretEnc'], parseEncryptionKey(KEY))).toBe(SECRET);
    expect(maps).toEqual([{ tenantId: 't1', wabaId: '111111', metaAppId: 'row-1234567890' }]);
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(report.secretFingerprint).toBe(crypto.createHash('sha256').update(SECRET).digest('hex').slice(0, 8));
  });

  it('refuses to store anything when the encryption key is missing or malformed', async () => {
    for (const encryptionKey of [undefined, '', 'not-base64-32-bytes', Buffer.from('short').toString('base64')]) {
      const { db, apps } = fakeDb();
      await expect(registerMetaApp(db, input({ encryptionKey }))).rejects.toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
      expect(apps).toHaveLength(0);
    }
  });

  it('refuses a mapping to a WABA the tenant does not own, before writing anything', async () => {
    const { db, apps, maps } = fakeDb();
    await expect(registerMetaApp(db, input({ mappings: ['t2:111111'] }))).rejects.toThrow(/no WhatsApp number/);
    expect(apps).toHaveLength(0); expect(maps).toHaveLength(0);
  });

  it('validates the app id, label, secret and mapping shape', async () => {
    const { db } = fakeDb();
    await expect(registerMetaApp(db, input({ appId: 'abc' }))).rejects.toThrow(/numeric/);
    await expect(registerMetaApp(db, input({ label: '  ' }))).rejects.toThrow(/label/);
    await expect(registerMetaApp(db, input({ secret: 'short' }))).rejects.toThrow(/16 to 128/);
    await expect(registerMetaApp(db, input({ secret: 'has a space in it 0123456789' }))).rejects.toThrow(/whitespace/);
    await expect(registerMetaApp(db, input({ mappings: ['just-one-part'] }))).rejects.toThrow(/tenantId:wabaId/);
  });
});
