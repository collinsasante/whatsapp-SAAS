/**
 * The re-encryption tool against a REAL PostgreSQL through the real Prisma adapters (buildTargets): proves compare-and-set, the JSON equality update on
 * channels.credentials, pagination, rollback to the exact original bytes, and that the application's own dual-read decrypt opens what the tool wrote.
 * Skipped unless REENCRYPT_TEST_DATABASE_URL is set (the database name must contain test/scratch/tmp):
 *   REENCRYPT_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/reencrypt_test npx jest src/common/crypto/credential-reencryption.db.spec.ts
 */
import { PrismaClient } from '@prisma/client';
import { decryptCredential, isEncryptedCredential, parseEncryptionKey } from '@whatsapp-platform/shared-utils';
import { reencryptCredentials } from './credential-reencryption';
import { buildTargets } from './credential-reencryption.targets';

const url = process.env['REENCRYPT_TEST_DATABASE_URL'];
if (url && !/(test|scratch|tmp)/i.test(new URL(url).pathname)) throw new Error('REENCRYPT_TEST_DATABASE_URL must name a throwaway database.');
const describeDb = url ? describe : describe.skip;

const KEY_B64 = Buffer.alloc(32, 5).toString('base64');
const KEY = parseEncryptionKey(KEY_B64)!;
const WRONG_B64 = Buffer.alloc(32, 6).toString('base64');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), CH_FB = id(11), CH_TT = id(12), CH_TG = id(13), CH_WEB = id(14);
const PLAIN = {
  wa: 'EAAB-wa-number-token', page: 'EAAB-page-token', session: 'EAAB-user-session-token', legacy: 'EAAB-legacy-tenant-token', airtable: 'pat.airtable-key',
  webhook: 'whsec_webhook_secret', auth: '{"creds":{"noiseKey":"sensitive"}}', tg: '123456:TELEGRAM-BOT', ttAccess: 'act.tiktok-access', ttRefresh: 'rft.tiktok-refresh',
};

describeDb('credential re-encryption (real database)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://skipped:skipped@127.0.0.1:1/skipped' } } });
  const targets = buildTargets(prisma);
  afterAll(async () => { await prisma.$disconnect(); });

  async function seed() {
    await prisma.$executeRawUnsafe('TRUNCATE tenants CASCADE');
    await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, webhook_verify_token, access_token, updated_at) VALUES ($1,'T','v',$2,now())`, T, PLAIN.legacy);
    for (const [c, type, name, creds] of [
      [CH_FB, 'FACEBOOK_MESSENGER', 'FB', {}],
      [CH_TT, 'TIKTOK', 'TT', { accessToken: PLAIN.ttAccess, refreshToken: PLAIN.ttRefresh, openId: 'open-1', externalId: 'open-1', scope: 'user.info.basic' }],
      [CH_TG, 'TELEGRAM', 'TG', { botToken: PLAIN.tg }],
      [CH_WEB, 'WHATSAPP_WEB', 'WEB', {}],
    ] as const) await prisma.$executeRawUnsafe(`INSERT INTO channels (id, tenant_id, type, name, credentials, metadata, updated_at) VALUES ($1,$2,$3::"ChannelType",$4,$5::jsonb,'{}',now())`, c, T, type, name, JSON.stringify(creds));
    await prisma.$executeRawUnsafe(`INSERT INTO whatsapp_numbers (id, tenant_id, label, phone_number_id, waba_id, access_token, updated_at) VALUES ($1,$2,'n','p1','w1',$3,now())`, id(21), T, PLAIN.wa);
    await prisma.$executeRawUnsafe(`INSERT INTO facebook_page_connections (id, tenant_id, channel_id, page_id, page_name, page_access_token, updated_at) VALUES ($1,$2,$3,'pg','Page',$4,now())`, id(22), T, CH_FB, PLAIN.page);
    await prisma.$executeRawUnsafe(`INSERT INTO oauth_connect_sessions (id, tenant_id, created_by_user_id, provider, user_access_token, candidate_pages, expires_at) VALUES ($1,$2,'u','facebook',$3,'[]'::jsonb,now() + interval '1 hour')`, id(23), T, PLAIN.session);
    await prisma.$executeRawUnsafe(`INSERT INTO tenant_settings (id, tenant_id, airtable_api_key, updated_at) VALUES ($1,$2,$3,now())`, id(24), T, PLAIN.airtable);
    await prisma.$executeRawUnsafe(`INSERT INTO webhooks (id, tenant_id, name, url, secret, updated_at) VALUES ($1,$2,'w','https://example.test/h',$3,now())`, id(25), T, PLAIN.webhook);
    await prisma.$executeRawUnsafe(`INSERT INTO whatsapp_web_sessions (id, tenant_id, channel_id, encrypted_auth_state, updated_at) VALUES ($1,$2,$3,$4,now())`, id(26), T, CH_WEB, PLAIN.auth);
  }
  const col = async (table: string, column: string, where: string) => (await prisma.$queryRawUnsafe<Array<{ v: string }>>(`SELECT ${column} AS v FROM ${table} WHERE ${where}`))[0]!.v;
  const creds = async (chId: string) => (await prisma.$queryRawUnsafe<Array<{ v: Record<string, string> }>>(`SELECT credentials AS v FROM channels WHERE id = '${chId}'`))[0]!.v;

  it('dry run reads all eight locations and writes nothing', async () => {
    await seed();
    const r = await reencryptCredentials(targets, KEY_B64, { mode: 'encrypt', apply: false });
    expect(Object.keys(r.targets)).toHaveLength(8);
    expect(r.targets['channels.credentials']).toMatchObject({ scanned: 4, toChange: 2, empty: 2 });
    for (const n of ['whatsapp_numbers.access_token', 'facebook_page_connections.page_access_token', 'oauth_connect_sessions.user_access_token', 'tenants.access_token', 'tenant_settings.airtable_api_key', 'webhooks.secret', 'whatsapp_web_sessions.encrypted_auth_state'])
      expect(r.targets[n]).toMatchObject({ scanned: 1, toChange: 1, changed: 0 });
    expect(await col('whatsapp_numbers', 'access_token', `id='${id(21)}'`)).toBe(PLAIN.wa);
  });

  it('encrypt applies everywhere, the stored values open with the application\'s own decrypt, identifiers are untouched, and a second run changes nothing', async () => {
    await seed();
    const r = await reencryptCredentials(targets, KEY_B64, { mode: 'encrypt', apply: true });
    expect(r.verification).toEqual({ ok: true, failures: 0 });
    expect(Object.values(r.targets).reduce((n, t) => n + t.changed, 0)).toBe(9);   // 7 string columns + 2 channel rows
    const checks: Array<[string, string, string, string]> = [
      ['whatsapp_numbers', 'access_token', `id='${id(21)}'`, PLAIN.wa], ['facebook_page_connections', 'page_access_token', `id='${id(22)}'`, PLAIN.page],
      ['oauth_connect_sessions', 'user_access_token', `id='${id(23)}'`, PLAIN.session], ['tenants', 'access_token', `id='${T}'`, PLAIN.legacy],
      ['tenant_settings', 'airtable_api_key', `id='${id(24)}'`, PLAIN.airtable], ['webhooks', 'secret', `id='${id(25)}'`, PLAIN.webhook],
      ['whatsapp_web_sessions', 'encrypted_auth_state', `id='${id(26)}'`, PLAIN.auth],
    ];
    for (const [t, c, w, plain] of checks) {
      const stored = await col(t, c, w);
      expect(isEncryptedCredential(stored)).toBe(true);
      expect(stored).not.toContain(plain);
      expect(decryptCredential(stored, KEY)).toBe(plain);
    }
    const tt = await creds(CH_TT);
    expect(decryptCredential(tt['accessToken'], KEY)).toBe(PLAIN.ttAccess);
    expect(decryptCredential(tt['refreshToken'], KEY)).toBe(PLAIN.ttRefresh);
    expect(tt).toMatchObject({ openId: 'open-1', externalId: 'open-1', scope: 'user.info.basic' });
    expect(decryptCredential((await creds(CH_TG))['botToken'], KEY)).toBe(PLAIN.tg);
    const second = await reencryptCredentials(targets, KEY_B64, { mode: 'encrypt', apply: true });
    expect(Object.values(second.targets).reduce((n, t) => n + t.toChange + t.changed, 0)).toBe(0);
  });

  it('rollback restores every original value exactly', async () => {
    await seed();
    await reencryptCredentials(targets, KEY_B64, { mode: 'encrypt', apply: true });
    const r = await reencryptCredentials(targets, KEY_B64, { mode: 'decrypt', apply: true });
    expect(r.verification).toEqual({ ok: true, failures: 0 });
    expect(await col('whatsapp_numbers', 'access_token', `id='${id(21)}'`)).toBe(PLAIN.wa);
    expect(await col('tenants', 'access_token', `id='${T}'`)).toBe(PLAIN.legacy);
    expect(await col('whatsapp_web_sessions', 'encrypted_auth_state', `id='${id(26)}'`)).toBe(PLAIN.auth);
    expect(await creds(CH_TT)).toEqual({ accessToken: PLAIN.ttAccess, refreshToken: PLAIN.ttRefresh, openId: 'open-1', externalId: 'open-1', scope: 'user.info.basic' });
    expect(await creds(CH_TG)).toEqual({ botToken: PLAIN.tg });
  });

  it('a wrong key aborts BEFORE writing anything, even when only some data is already encrypted', async () => {
    await seed();
    await reencryptCredentials([targets.find((t) => t.name === 'whatsapp_numbers.access_token')!], KEY_B64, { mode: 'encrypt', apply: true });   // partial state
    const r = await reencryptCredentials(targets, WRONG_B64, { mode: 'encrypt', apply: true });
    expect(r.aborted).toBeDefined();
    expect(r.targets['whatsapp_numbers.access_token']!.undecryptable).toBe(1);
    expect(await col('tenants', 'access_token', `id='${T}'`)).toBe(PLAIN.legacy);                 // nothing else was touched
    expect(JSON.stringify(r)).not.toContain(PLAIN.wa);
  });

  it('compare-and-set against the real database: a value rewritten by the application mid-run is kept', async () => {
    await seed();
    const wa = targets.find((t) => t.name === 'whatsapp_numbers.access_token')!;
    const original = wa.replace.bind(wa);
    wa.replace = async (rowId, expected, next) => { await prisma.$executeRawUnsafe(`UPDATE whatsapp_numbers SET access_token = 'rewritten-by-app' WHERE id = $1`, rowId); return original(rowId, expected, next); };
    const r = await reencryptCredentials([wa], KEY_B64, { mode: 'encrypt', apply: true });
    wa.replace = original;
    expect(r.targets['whatsapp_numbers.access_token']).toMatchObject({ changed: 0, changedConcurrently: 1 });
    expect(await col('whatsapp_numbers', 'access_token', `id='${id(21)}'`)).toBe('rewritten-by-app');
  });

  it('pagination across many rows on a real table', async () => {
    await seed();
    for (let i = 0; i < 37; i++) await prisma.$executeRawUnsafe(`INSERT INTO whatsapp_numbers (id, tenant_id, label, phone_number_id, waba_id, access_token, updated_at) VALUES ($1,$2,'n','p${i + 100}','w1',$3,now())`, id(1000 + i), T, `token-${i}`);
    const r = await reencryptCredentials(targets, KEY_B64, { mode: 'encrypt', apply: true, batch: 10 });
    expect(r.targets['whatsapp_numbers.access_token']).toMatchObject({ scanned: 38, changed: 38 });
    expect(r.verification!.ok).toBe(true);
  });
});
