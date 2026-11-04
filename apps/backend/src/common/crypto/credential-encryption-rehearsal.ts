/**
 * Credential-encryption REHEARSAL. Drives the real re-encryption engine and the real CLI against a DISPOSABLE database, with a disposable key generated
 * in memory, and checks every property the production window depends on. Prints check names, counts and booleans only: never a credential, a key, an id.
 *
 *   REHEARSAL_DATABASE_URL=postgresql://user@127.0.0.1:5432/rehearsal_creds  (migrations applied; the name must contain rehearsal/scratch/test/tmp)
 *   [PG_BIN_DIR=/path/to/postgres/bin]   pnpm --filter @whatsapp-platform/backend exec ts-node src/common/crypto/credential-encryption-rehearsal.ts
 *
 * It refuses to run against anything else, wipes the database it is given, and never reads CREDENTIALS_ENCRYPTION_KEY from the environment: the key it
 * uses exists only in this process. It is NOT a way to test the production key, which must never be generated, requested or transmitted by this work.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { spawnSync, execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decryptCredential, encryptCredential, isEncryptedCredential } from '@whatsapp-platform/shared-utils';
import { CredentialTarget, reencryptCredentials } from './credential-reencryption';
import { buildTargets } from './credential-reencryption.targets';

const url = process.env['REHEARSAL_DATABASE_URL'] ?? '';
if (!url || !/(rehearsal|scratch|test|tmp)/i.test(new URL(url).pathname)) {
  console.error('REHEARSAL_DATABASE_URL must point at a disposable database whose name contains rehearsal, scratch, test or tmp.');
  process.exit(2);
}
const pgBin = (tool: string) => (process.env['PG_BIN_DIR'] ? path.join(process.env['PG_BIN_DIR'], tool) : tool);
const prisma = new PrismaClient({ datasources: { db: { url } } });
const keyA = crypto.randomBytes(32).toString('base64');     // the disposable key, in memory only
const keyB = crypto.randomBytes(32).toString('base64');     // a different key, for the wrong-key checks
const buf = (k: string) => Buffer.from(k, 'base64');

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// ─── seeding ──────────────────────────────────────────────────────────────────────────────────────
interface Seeded { secrets: string[]; locations: Record<string, number>; tenantId: string }
const secret = (label: string) => `REHEARSAL-${label}-${crypto.randomBytes(9).toString('hex')}`;

async function seed(opts: { encryptSomeWith?: string } = {}): Promise<Seeded> {
  await prisma.$executeRawUnsafe('TRUNCATE tenants CASCADE');
  const secrets: string[] = [];
  const s = (label: string, enc = false) => { const v = secret(label); secrets.push(v); return enc && opts.encryptSomeWith ? encryptCredential(v, buf(opts.encryptSomeWith)) : v; };
  const tenant = await prisma.tenant.create({ data: { name: 'Rehearsal', webhookVerifyToken: 'v', accessToken: s('legacy-tenant') } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, name: 'U', email: `u-${crypto.randomBytes(4).toString('hex')}@rehearsal.test`, passwordHash: 'x', role: 'ADMIN' } });
  await prisma.tenantSettings.create({ data: { tenantId: tenant.id, airtableApiKey: s('airtable') } });
  await prisma.whatsAppNumber.createMany({ data: [0, 1, 2].map((i) => ({ tenantId: tenant.id, label: `n${i}`, phoneNumberId: `pn${i}`, wabaId: `w${i}`, accessToken: s(`wa-${i}`, i === 2) })) });
  const fbChannel = await prisma.channel.create({ data: { tenantId: tenant.id, type: 'FACEBOOK_MESSENGER', name: 'Page', credentials: {} } });
  await prisma.facebookPageConnection.create({ data: { tenantId: tenant.id, channelId: fbChannel.id, pageId: 'p1', pageName: 'Page', pageAccessToken: s('fb-page') } });
  await prisma.oAuthConnectSession.create({ data: { tenantId: tenant.id, createdByUserId: user.id, provider: 'facebook', userAccessToken: s('oauth-user'), candidatePages: [], expiresAt: new Date(Date.now() + 3_600_000) } });
  await prisma.webhook.createMany({ data: [{ tenantId: tenant.id, name: 'a', url: 'https://x.test/a', secret: s('webhook-a') }, { tenantId: tenant.id, name: 'b', url: 'https://x.test/b', secret: null }] });
  const wwChannel = await prisma.channel.create({ data: { tenantId: tenant.id, type: 'WHATSAPP_WEB', name: 'QR', credentials: {} } });
  await prisma.whatsAppWebSession.create({ data: { tenantId: tenant.id, channelId: wwChannel.id, encryptedAuthState: s('baileys-state') } });
  // channels.credentials JSON: Telegram, TikTok (posting), TikTok (messaging), Instagram: every token field the tool covers
  await prisma.channel.create({ data: { tenantId: tenant.id, type: 'TELEGRAM', name: 'Bot', credentials: { botToken: s('telegram-bot'), webhookSecret: s('telegram-hook'), externalId: '123' } } });
  await prisma.channel.create({ data: { tenantId: tenant.id, type: 'TIKTOK', name: 'TT', credentials: { accessToken: s('tt-access'), refreshToken: s('tt-refresh'), openId: 'o' } } });
  await prisma.channel.create({ data: { tenantId: tenant.id, type: 'TIKTOK', name: 'TT msg', externalId: 'biz:1', credentials: { kind: 'business_messaging', accessToken: s('ttm-access'), refreshToken: s('ttm-refresh'), businessId: '1' } } });
  await prisma.channel.create({ data: { tenantId: tenant.id, type: 'INSTAGRAM', name: 'IG', credentials: { accessToken: s('ig-access') } } });
  const locations: Record<string, number> = {};
  for (const t of buildTargets(prisma)) locations[t.name] = (await t.list(null, 1000)).length;
  return { secrets, locations, tenantId: tenant.id };
}

/** Hash of every credential-bearing value in every location, in a stable order. Equal hashes = byte-identical credential state. */
async function stateHash(client: PrismaClient = prisma): Promise<string> {
  const h = crypto.createHash('sha256');
  for (const t of buildTargets(client)) {
    const rows = await t.list(null, 10_000);
    for (const r of rows) h.update(`${t.name}\u0000${r.id}\u0000${JSON.stringify(r.raw)}\u0000`);
  }
  return h.digest('hex');
}

async function counts(): Promise<{ encrypted: number; plaintext: number }> {
  let encrypted = 0; let plaintext = 0;
  for (const t of buildTargets(prisma)) {
    for (const r of await t.list(null, 10_000)) {
      const vals: unknown[] = t.jsonFields.length ? t.jsonFields.map((f) => (r.raw as Record<string, unknown> | null)?.[f]) : [r.raw];
      for (const v of vals) if (typeof v === 'string' && v) (isEncryptedCredential(v) ? encrypted++ : plaintext++);
    }
  }
  return { encrypted, plaintext };
}

function dumpText(): string {
  const u = new URL(url);
  return execFileSync(pgBin('pg_dump'), ['--data-only', '--no-owner', '-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), u.pathname.slice(1)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) } });
}

function cli(args: string[], key: string | undefined): { code: number; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url };
  delete env['CREDENTIALS_ENCRYPTION_KEY'];
  if (key !== undefined) env['CREDENTIALS_ENCRYPTION_KEY'] = key;
  const r = spawnSync('npx', ['ts-node', path.join(__dirname, 'credential-reencryption.cli.ts'), ...args], { env, encoding: 'utf8', cwd: path.resolve(__dirname, '../../..') });
  return { code: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

async function decryptsAll(key: string, secrets: string[]): Promise<boolean> {
  // every seeded plaintext is recoverable from the stored state with the key
  const found = new Set<string>();
  for (const t of buildTargets(prisma)) {
    for (const r of await t.list(null, 10_000)) {
      const vals: unknown[] = t.jsonFields.length ? t.jsonFields.map((f) => (r.raw as Record<string, unknown> | null)?.[f]) : [r.raw];
      for (const v of vals) if (typeof v === 'string' && v) found.add(isEncryptedCredential(v) ? decryptCredential(v, buf(key)) : v);
    }
  }
  return secrets.every((s) => found.has(s));
}

async function main() {
  // ── 1. inventory: all locations present, dry run reads and writes nothing ──────────────────────
  let seeded = await seed();
  const before = await stateHash();
  check('all 8 credential locations are covered by the tool', buildTargets(prisma).length === 8);
  check('every location holds at least one seeded credential', Object.values(seeded.locations).every((n) => n >= 1), JSON.stringify(seeded.locations));
  const dry = cli([], keyA);
  check('CLI dry run exits 0 and says nothing was written', dry.code === 0 && /DRY RUN/.test(dry.out));
  check('dry run left the database byte-identical', (await stateHash()) === before);
  const plainDump = dumpText();
  check('before encryption, the dump DOES contain the seeded secrets (so the dump check can detect them)', seeded.secrets.every((s) => plainDump.includes(s)));

  // ── 2. backup, then apply ────────────────────────────────────────────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-rehearsal-'));
  fs.chmodSync(tmp, 0o700);
  const backup = path.join(tmp, 'before.dump');
  const u = new URL(url);
  const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  execFileSync(pgBin('pg_dump'), ['-Fc', '--no-owner', '-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-f', backup, u.pathname.slice(1)], { env: pgEnv });
  check('a restorable backup was taken before any write', fs.statSync(backup).size > 0);

  const noFlag = cli(['--apply'], keyA);
  check('CLI refuses --apply without the backup acknowledgement, writing nothing', noFlag.code !== 0 && (await stateHash()) === before);

  const apply = cli(['--apply', '--i-have-a-verified-backup'], keyA);
  check('CLI apply exits 0 with a passing verification pass', apply.code === 0 && /"ok": true/.test(apply.out));
  const afterApply = await counts();
  check('after apply: no credential is plaintext, and there is ciphertext in every location', afterApply.plaintext === 0 && afterApply.encrypted >= Object.keys(seeded.locations).length, `encrypted=${afterApply.encrypted}`);
  check('every original credential is recoverable with the key', await decryptsAll(keyA, seeded.secrets));
  const encDump = dumpText();
  check('DUMP CHECK: no seeded secret appears anywhere in a fresh dump', seeded.secrets.every((s) => !encDump.includes(s)));
  const everyOutput = [dry.out, noFlag.out, apply.out].join('\n');
  check('CLI output never contains a credential, the key or a tenant id', seeded.secrets.every((s) => !everyOutput.includes(s)) && !everyOutput.includes(keyA) && !everyOutput.includes(seeded.tenantId));

  // ── 3. idempotent ────────────────────────────────────────────────────────────────────────────
  const again = cli(['--apply', '--i-have-a-verified-backup'], keyA);
  const afterAgain = await stateHash();
  check('a second apply changes nothing (idempotent)', again.code === 0 && /"changed": 0/.test(again.out) && !/"changed": [1-9]/.test(again.out));
  check('and does not double-encrypt: values still decrypt once to the originals', await decryptsAll(keyA, seeded.secrets));
  void afterAgain;

  // ── 4. wrong key: aborts before any write ────────────────────────────────────────────────────
  const encryptedHash = await stateHash();
  const wrong = cli(['--apply', '--i-have-a-verified-backup'], keyB);
  check('wrong key: CLI exits non-zero and reports the abort', wrong.code !== 0 && /aborted/.test(wrong.out));
  check('wrong key: the database is byte-identical afterwards (aborted BEFORE any write)', (await stateHash()) === encryptedHash);
  const wrongDec = cli(['--decrypt', '--apply', '--i-have-a-verified-backup'], keyB);
  check('wrong key on rollback also aborts without writing', wrongDec.code !== 0 && (await stateHash()) === encryptedHash);
  for (const [label, k] of [['missing key', undefined], ['malformed key', 'not-a-key'], ['short key', Buffer.alloc(16).toString('base64')]] as const) {
    const r = cli(['--apply', '--i-have-a-verified-backup'], k);
    check(`${label}: CLI refuses and writes nothing`, r.code !== 0 && (await stateHash()) === encryptedHash);
  }
  check('wrong-key output stays free of credentials and keys', seeded.secrets.every((s) => !wrong.out.includes(s)) && !wrong.out.includes(keyA) && !wrong.out.includes(keyB));

  // ── 5. key loss: ciphertext is unreadable without the key, and the backup is the way back ────
  let unreadable = 0;
  for (const t of buildTargets(prisma)) for (const r of await t.list(null, 10_000)) {
    const vals: unknown[] = t.jsonFields.length ? t.jsonFields.map((f) => (r.raw as Record<string, unknown> | null)?.[f]) : [r.raw];
    for (const v of vals) if (typeof v === 'string' && isEncryptedCredential(v)) { try { decryptCredential(v, buf(keyB)); } catch { unreadable++; } }
  }
  check('KEY LOSS: with a different key every ciphertext is unreadable (nothing silently decrypts)', unreadable === afterApply.encrypted, `unreadable=${unreadable}`);
  const restoredName = `${u.pathname.slice(1)}_restored`;
  const admin = (sql: string) => execFileSync(pgBin('psql'), ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: pgEnv });
  admin(`DROP DATABASE IF EXISTS "${restoredName}"`); admin(`CREATE DATABASE "${restoredName}"`);
  execFileSync(pgBin('pg_restore'), ['--no-owner', '-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', restoredName, backup], { env: pgEnv });
  const restoredUrl = new URL(url); restoredUrl.pathname = `/${restoredName}`;
  const restored = new PrismaClient({ datasources: { db: { url: restoredUrl.toString() } } });
  check('RESTORE: the pre-encryption backup restores to a byte-identical credential state', (await stateHash(restored)) === before);
  await restored.$disconnect();
  admin(`DROP DATABASE "${restoredName}"`);

  // ── 6. rollback restores the exact original bytes ───────────────────────────────────────────
  const rb = cli(['--decrypt', '--apply', '--i-have-a-verified-backup'], keyA);
  check('ROLLBACK (--decrypt) exits 0 and verifies', rb.code === 0 && /"ok": true/.test(rb.out));
  check('rollback returns the database to the EXACT original bytes', (await stateHash()) === before);

  // ── 7. already-encrypted and mixed data ──────────────────────────────────────────────────────
  seeded = await seed({ encryptSomeWith: keyA });
  const mixed = await counts();
  check('mixed data: seeded with some values already encrypted', mixed.encrypted >= 1 && mixed.plaintext >= 1);
  const mixApply = cli(['--apply', '--i-have-a-verified-backup'], keyA);
  check('mixed data: apply succeeds, nothing left plaintext, originals recoverable (no double encryption)', mixApply.code === 0 && (await counts()).plaintext === 0 && await decryptsAll(keyA, seeded.secrets));

  // ── 8. interrupted run, then resume ──────────────────────────────────────────────────────────
  seeded = await seed();
  const original = await stateHash();
  let writes = 0;
  const interrupting: CredentialTarget[] = buildTargets(prisma).map((t) => ({ ...t, replace: async (id, exp, next) => { if (++writes === 4) throw new Error('simulated crash'); return t.replace(id, exp, next); } }));
  let crashed = false;
  try { await reencryptCredentials(interrupting, keyA, { mode: 'encrypt', apply: true }); } catch { crashed = true; }
  const partial = await counts();
  check('INTERRUPTED: the run died part-way, leaving a mix of encrypted and plaintext', crashed && partial.encrypted >= 1 && partial.plaintext >= 1, `encrypted=${partial.encrypted} plaintext=${partial.plaintext}`);
  check('INTERRUPTED: nothing is corrupt - every credential is still recoverable with the key', await decryptsAll(keyA, seeded.secrets));
  // The dangerous case: a half-finished run followed by the WRONG key. Without the pre-write key check, the remaining plaintext would be encrypted with
  // key B next to rows encrypted with key A, silently splitting the data across two keys.
  const partialHash = await stateHash();
  const wrongOnPartial = cli(['--apply', '--i-have-a-verified-backup'], keyB);
  check('INTERRUPTED + WRONG KEY: aborts before writing, leaving the half-finished state untouched', wrongOnPartial.code !== 0 && /aborted/.test(wrongOnPartial.out) && (await stateHash()) === partialHash);
  const resume = cli(['--apply', '--i-have-a-verified-backup'], keyA);
  check('INTERRUPTED: re-running finishes the job and verifies', resume.code === 0 && (await counts()).plaintext === 0 && await decryptsAll(keyA, seeded.secrets));
  void original;

  // ── 9. compare-and-set conflict: the application edits a row while the tool runs ─────────────
  seeded = await seed();
  const target = (await prisma.tenantSettings.findFirstOrThrow()).id;
  let collided = false;
  const racing: CredentialTarget[] = buildTargets(prisma).map((t) => t.name !== 'tenant_settings.airtable_api_key' ? t : ({
    ...t,
    replace: async (id, exp, next) => {
      if (!collided) { collided = true; await prisma.tenantSettings.update({ where: { id: target }, data: { airtableApiKey: 'APP-WROTE-THIS-WHILE-THE-TOOL-RAN' } }); }
      return t.replace(id, exp, next);
    },
  }));
  const raced = await reencryptCredentials(racing, keyA, { mode: 'encrypt', apply: true });
  const appValue = (await prisma.tenantSettings.findFirstOrThrow()).airtableApiKey;
  check('CAS CONFLICT: the tool did not overwrite the application\'s newer value', collided && appValue === 'APP-WROTE-THIS-WHILE-THE-TOOL-RAN');
  check('CAS CONFLICT: it counted the conflict and its verification asked for a re-run', raced.targets['tenant_settings.airtable_api_key']!.changedConcurrently === 1 && raced.verification?.ok === false);
  const converge = cli(['--apply', '--i-have-a-verified-backup'], keyA);
  check('CAS CONFLICT: a re-run converges (the newer value is encrypted too)', converge.code === 0 && (await counts()).plaintext === 0);

  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join('; ')); process.exitCode = 1; }
}

main().catch((e) => { console.error('rehearsal error:', e instanceof Error ? e.name : 'error'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
