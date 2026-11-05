import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { createTestingApp } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';
import { PrismaService } from '../src/prisma/prisma.service';
import { CredentialsEncryptionService } from '../src/common/crypto/credentials-encryption.service';
import { WhatsappWebhookSignatureService } from '../src/whatsapp/webhook-signature/whatsapp-webhook-signature.service';
import { WebhookSecurityAdminService } from '../src/whatsapp/webhook-signature/webhook-security-admin.service';
import { MetaSubscribedAppsClient, SubscribedAppsResult } from '../src/whatsapp/webhook-signature/meta-subscribed-apps.client';

/**
 * WhatsApp webhook signature registry on the real route, a real database and the real encryption service. Meta is never called: the one place that
 * would call it (discover) is given a fake client. Secrets here are throwaway test values.
 */
describe('WhatsApp webhook signature registry (e2e)', () => {
  let app: INestApplication;
  const KEY = crypto.randomBytes(32).toString('base64');
  const S1 = 'app-one-secret-' + crypto.randomBytes(12).toString('hex');
  const S2 = 'app-two-secret-' + crypto.randomBytes(12).toString('hex');
  const APP1 = '1111111111';
  const APP2 = '2222222222';
  const W1 = '100000000001';
  const W2 = '100000000002';
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ['CREDENTIALS_ENCRYPTION_KEY', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_SIGNATURE_MODE']) saved[k] = process.env[k];
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    delete process.env['WHATSAPP_APP_SECRET'];
    delete process.env['WHATSAPP_WEBHOOK_SIGNATURE_MODE']; // NODE_ENV=test => the default is enforce
    app = await createTestingApp({ validation: true });
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  beforeEach(async () => {
    await resetTestDatabase();
    app.get(WhatsappWebhookSignatureService).invalidate();
  });

  const api = () => request(app.getHttpServer());
  const admin = () => app.get(WebhookSecurityAdminService);

  async function platformAdmin(role: 'SUPER_ADMIN' | 'VIEWER') {
    const row = await testPrisma.platformAdmin.create({ data: { email: `${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, name: role, role, passwordHash: 'x' } });
    const token = app.get(JwtService).sign({ sub: row.id, role: 'platform_admin', adminRole: role, email: row.email }, { secret: process.env.JWT_SECRET ?? 'changeme', expiresIn: '1h' });
    return { id: row.id, auth: { Authorization: `Bearer ${token}` } };
  }

  async function workspace(name: string, wabaId: string) {
    const { tenant } = await createTenantWithUser({ tenantName: name });
    await testPrisma.whatsAppNumber.create({ data: { tenantId: tenant.id, label: 'Default', phoneNumberId: `pn-${wabaId}`, wabaId, accessToken: 'tenant-token-placeholder' } });
    return tenant;
  }

  /** Registers both apps with secrets and maps W1 to app 1, W2 to app 2. */
  async function registerBoth() {
    const t1 = await workspace('Tenant One', W1);
    const t2 = await workspace('Tenant Two', W2);
    await admin().upsertApp(APP1, { label: 'App One', secret: S1 });
    await admin().upsertApp(APP2, { label: 'App Two', secret: S2 });
    await admin().mapWaba(APP1, t1.id, W1);
    await admin().mapWaba(APP2, t2.id, W2);
    return { t1, t2 };
  }

  const payload = (wabaId: string) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [] }] });
  const sign = (raw: string, secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const post = (tenantId: string, raw: string, signature?: string) => {
    const r = api().post(`/webhook/whatsapp/${tenantId}`).set('Content-Type', 'application/json');
    return (signature ? r.set('x-hub-signature-256', signature) : r).send(raw);
  };
  const settle = () => new Promise((r) => setTimeout(r, 150)); // statistics are written after the response
  const stat = (outcome: string, wabaId?: string) => testPrisma.whatsappWebhookSignatureStat.aggregate({ _sum: { count: true }, where: { outcome, ...(wabaId ? { wabaId } : {}) } }).then((r) => r._sum.count ?? 0);

  describe('on the real route (enforce, the default outside production)', () => {
    it('accepts each app only for the WABAs mapped to it, and refuses forged, unsigned and unmapped requests', async () => {
      const { t1 } = await registerBoth();
      await post(t1.id, payload(W1), sign(payload(W1), S1)).expect(200);                    // app 1 for its own WABA
      await post(t1.id, payload(W2), sign(payload(W2), S2)).expect(200);                    // app 2 for its own WABA
      await post(t1.id, payload(W1), sign(payload(W1), S2)).expect(400);                    // genuine app-2 signature on app 1's WABA
      await post(t1.id, payload(W1), sign(payload(W1), 'attacker-secret-0000')).expect(400); // forged
      await post(t1.id, payload(W1)).expect(400);                                           // unsigned
      await post(t1.id, payload('100000000099'), sign(payload('100000000099'), S1)).expect(400); // WABA nobody is mapped to
      await settle();
      expect(await stat('valid')).toBe(2);
      expect(await stat('app_not_mapped')).toBe(2);
      expect(await stat('invalid')).toBe(1);
      expect(await stat('missing_signature')).toBe(1);
    });

    it('invented WABA ids cannot create statistics rows: unknown ids share one bucket, known ones keep their own', async () => {
      const { t1 } = await registerBoth();
      for (let i = 0; i < 8; i++) {
        const fake = String(900000000000 + i);
        await post(t1.id, payload(fake), sign(payload(fake), 'attacker-secret-0000')).expect(400);
      }
      await post(t1.id, payload(W1), sign(payload(W1), 'attacker-secret-0000')).expect(400);
      await settle(); await settle();
      const rows = await testPrisma.whatsappWebhookSignatureStat.findMany({ select: { wabaId: true, outcome: true, count: true } });
      expect(rows.map((r) => r.wabaId).sort()).toEqual([W1, 'unknown']);
      expect(rows.find((r) => r.wabaId === 'unknown')).toMatchObject({ outcome: 'invalid', count: 8 });
    });

    it('is not fooled by editing the body after it was signed', async () => {
      const { t1 } = await registerBoth();
      const signed = sign(payload(W1), S1);
      await post(t1.id, payload(W1) + ' ', signed).expect(400);
    });

    it('with no app registered at all it lets requests through and records no_secrets (a self-lockout guard), instead of refusing every tenant', async () => {
      const { tenant } = await createTenantWithUser();
      await post(tenant.id, payload(W1), 'sha256=anything').expect(200);
      await settle();
      expect(await stat('no_secrets')).toBe(1);
    });

    it('a new secret or mapping applies on the next request (the cache is invalidated by the admin edit)', async () => {
      const { t1 } = await registerBoth();
      await post(t1.id, payload(W1), sign(payload(W1), S1)).expect(200);
      const NEW = 'rotated-secret-' + crypto.randomBytes(12).toString('hex');
      await admin().upsertApp(APP1, { label: 'App One', secret: NEW });
      await post(t1.id, payload(W1), sign(payload(W1), S1)).expect(400);
      await post(t1.id, payload(W1), sign(payload(W1), NEW)).expect(200);
    });

    it('a disabled app no longer vouches for anything', async () => {
      const { t1 } = await registerBoth();
      await admin().upsertApp(APP1, { label: 'App One', status: 'DISABLED' });
      await post(t1.id, payload(W1), sign(payload(W1), S1)).expect(400);
    });
  });

  describe('observe mode (the production default): measures, never rejects', () => {
    function observer(extra: Record<string, string> = {}) {
      const values: Record<string, string> = { NODE_ENV: 'production', ...extra };
      const config = { get: (k: string) => values[k] } as unknown as ConfigService;
      return new WhatsappWebhookSignatureService(app.get(PrismaService), app.get(CredentialsEncryptionService), config);
    }

    it('accepts forged, unsigned and unmapped requests alike, and counts each honestly', async () => {
      await registerBoth();
      const svc = observer();
      expect(svc.mode).toBe('observe');
      const raw = Buffer.from(payload(W1));
      const entries = [{ id: W1 }];
      const verdicts = await Promise.all([
        svc.verify(raw, sign(payload(W1), S1), entries),
        svc.verify(raw, sign(payload(W1), 'attacker-secret-0000'), entries),
        svc.verify(raw, undefined, entries),
        svc.verify(raw, sign(payload(W1), S2), entries),
      ]);
      expect(verdicts.map((v) => v.accept)).toEqual([true, true, true, true]);
      expect(verdicts.map((v) => v.evaluation.outcome)).toEqual(['valid', 'invalid', 'missing_signature', 'app_not_mapped']);
      await settle();
      expect(await stat('valid', W1)).toBe(1);
      expect(await stat('invalid', W1)).toBe(1);
    });

    it('an unrecognised mode value in production falls back to observe, never to enforce', () => {
      expect(observer({ WHATSAPP_WEBHOOK_SIGNATURE_MODE: 'enforced' }).mode).toBe('observe');
    });

    it('explicit enforce in production rejects, and explicit off checks nothing', async () => {
      await registerBoth();
      const raw = Buffer.from(payload(W1));
      expect((await observer({ WHATSAPP_WEBHOOK_SIGNATURE_MODE: 'enforce' }).verify(raw, 'sha256=00', [{ id: W1 }])).accept).toBe(false);
      const off = await observer({ WHATSAPP_WEBHOOK_SIGNATURE_MODE: 'off' }).verify(raw, 'sha256=00', [{ id: W1 }]);
      expect(off.accept).toBe(true);
    });

    it('counts exactly under concurrency (a first-of-the-day race must not lose or double count)', async () => {
      await registerBoth();
      const svc = observer();
      const raw = Buffer.from(payload(W1));
      await Promise.all(Array.from({ length: 25 }, () => svc.verify(raw, sign(payload(W1), S1), [{ id: W1 }])));
      await settle();
      await new Promise((r) => setTimeout(r, 300));
      expect(await stat('valid', W1)).toBe(25);
    });

    it('the legacy single WHATSAPP_APP_SECRET still works as a catch-all app for one-app installs', async () => {
      const LEG = 'legacy-secret-' + crypto.randomBytes(12).toString('hex');
      const svc = observer({ WHATSAPP_APP_SECRET: LEG });
      const raw = Buffer.from(payload(W1));
      const v = await svc.verify(raw, sign(payload(W1), LEG), [{ id: W1 }]);
      expect(v.evaluation).toMatchObject({ outcome: 'valid', appId: 'env:WHATSAPP_APP_SECRET' });
    });
  });

  describe('secrets at rest', () => {
    it('stores the app secret encrypted, never returns it, and keeps it out of the audit log', async () => {
      const root = await platformAdmin('SUPER_ADMIN');
      const res = await api().put(`/platform-admin/whatsapp-webhook-security/apps/${APP1}`).set(root.auth).send({ label: 'App One', secret: S1 }).expect(200);
      expect(JSON.stringify(res.body)).not.toContain(S1);
      expect(res.body).toMatchObject({ appId: APP1, hasSecret: true, status: 'ACTIVE' });
      expect(res.body.secretFingerprint).toMatch(/^[0-9a-f]{8}$/);
      expect(res.body.secretFingerprint).toBe(crypto.createHash('sha256').update(S1).digest('hex').slice(0, 8));

      const [row] = await testPrisma.$queryRaw<Array<{ secret_enc: string }>>`SELECT secret_enc FROM whatsapp_meta_apps WHERE app_id = ${APP1}`;
      expect(row!.secret_enc.startsWith('enc:v1:')).toBe(true);
      expect(row!.secret_enc).not.toContain(S1);

      const audit = await testPrisma.platformAuditLog.findMany({ where: { action: 'whatsapp_app.upsert' } });
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0])).not.toContain(S1);
      expect(audit[0]!.metadata).toMatchObject({ secretChanged: true });

      const list = await api().get('/platform-admin/whatsapp-webhook-security/apps').set(root.auth).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(S1);
      expect(JSON.stringify(list.body)).not.toContain('enc:v1');
    });

    it('refuses to store a secret when no encryption key is configured, instead of falling back to plaintext', async () => {
      const keyless = new CredentialsEncryptionService({ get: () => undefined } as unknown as ConfigService);
      expect(keyless.isActive).toBe(false);
      const svc = new WebhookSecurityAdminService(app.get(PrismaService), keyless, app.get(WhatsappWebhookSignatureService), app.get(MetaSubscribedAppsClient));
      await expect(svc.upsertApp(APP1, { label: 'App One', secret: S1 })).rejects.toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
      expect(await testPrisma.whatsappMetaApp.count()).toBe(0);
    });

    it('ignores a row whose secret is not in encrypted form (written around the API) rather than trusting it', async () => {
      const { t1 } = await registerBoth();
      await testPrisma.whatsappMetaApp.update({ where: { appId: APP1 }, data: { secretEnc: S1 } }); // plaintext, as if inserted by hand
      app.get(WhatsappWebhookSignatureService).invalidate();
      await post(t1.id, payload(W1), sign(payload(W1), S1)).expect(400);
    });

    it('validates input: a bad app id, a short secret or an unknown field is refused', async () => {
      const root = await platformAdmin('SUPER_ADMIN');
      await api().put('/platform-admin/whatsapp-webhook-security/apps/not-a-number').set(root.auth).send({ label: 'x', secret: S1 }).expect(400);
      await api().put(`/platform-admin/whatsapp-webhook-security/apps/${APP1}`).set(root.auth).send({ label: 'x', secret: 'short' }).expect(400);
      await api().put(`/platform-admin/whatsapp-webhook-security/apps/${APP1}`).set(root.auth).send({ label: 'x', surprise: 1 }).expect(400);
      expect(await testPrisma.whatsappMetaApp.count()).toBe(0);
    });
  });

  describe('who may do what', () => {
    it('a viewer can read but not change; no token or a tenant token is refused', async () => {
      const viewer = await platformAdmin('VIEWER');
      const { user } = await createTenantWithUser();
      const base = '/platform-admin/whatsapp-webhook-security';
      await api().get(`${base}/apps`).set(viewer.auth).expect(200);
      await api().get(`${base}/summary`).set(viewer.auth).expect(200);
      await api().put(`${base}/apps/${APP1}`).set(viewer.auth).send({ label: 'x' }).expect(403);
      await api().post(`${base}/discover`).set(viewer.auth).send({}).expect(403);
      await api().delete(`${base}/mappings/anything`).set(viewer.auth).expect(403);
      await api().get(`${base}/apps`).expect(401);
      const tenantToken = app.get(JwtService).sign({ sub: user.id, tenantId: user.tenantId, role: 'ADMIN' }, { secret: process.env.JWT_SECRET ?? 'changeme' });
      await api().get(`${base}/apps`).set({ Authorization: `Bearer ${tenantToken}` }).expect(403);
    });
  });

  describe('mapping', () => {
    it('a tenant can only be mapped to a WABA it really owns', async () => {
      const { t1, t2 } = await registerBoth();
      await expect(admin().mapWaba(APP1, t1.id, W2)).rejects.toThrow(/no WhatsApp number on this WABA/);
      await expect(admin().mapWaba(APP1, t2.id, W1)).rejects.toThrow(/no WhatsApp number on this WABA/);
      await expect(admin().mapWaba('9999999999', t1.id, W1)).rejects.toThrow(/not registered/);
    });

    it('mapping twice is harmless, and removing a mapping stops the app vouching for that WABA', async () => {
      const { t1 } = await registerBoth();
      const again = await admin().mapWaba(APP1, t1.id, W1);
      expect(await testPrisma.whatsappWabaApp.count({ where: { tenantId: t1.id } })).toBe(1);
      await admin().unmap(again.id);
      await post(t1.id, payload(W1), sign(payload(W1), S1)).expect(400);
    });

    it('two apps may serve one WABA, and either signature is then accepted', async () => {
      const { t1 } = await registerBoth();
      await admin().mapWaba(APP2, t1.id, W1);
      await post(t1.id, payload(W1), sign(payload(W1), S1)).expect(200);
      await post(t1.id, payload(W1), sign(payload(W1), S2)).expect(200);
    });
  });

  describe('readiness summary', () => {
    it('reports each WABA as ready, not ready or without traffic, and blocks enforcement until every one with traffic is clean', async () => {
      const { t1 } = await registerBoth();
      const t3 = await workspace('Quiet Tenant', '100000000003');
      void t3;
      for (let i = 0; i < 3; i++) await post(t1.id, payload(W1), sign(payload(W1), S1)).expect(200);
      for (let i = 0; i < 3; i++) await post(t1.id, payload(W2), sign(payload(W2), S2)).expect(200);
      await settle(); await settle();

      let s = await admin().summary(7, 3);
      const byWaba = Object.fromEntries(s.coverage.map((c) => [c.wabaId, c.verdict]));
      expect(byWaba).toMatchObject({ [W1]: 'ready', [W2]: 'ready', '100000000003': 'no_traffic' });
      expect(s.readyToEnforce).toBe(true);

      // one bad request for W1 makes it not ready and blocks enforcement
      await post(t1.id, payload(W1), sign(payload(W1), 'attacker-secret-0000')).expect(400);
      await settle();
      s = await admin().summary(7, 3);
      expect(s.coverage.find((c) => c.wabaId === W1)).toMatchObject({ verdict: 'not_ready' });
      expect(s.readyToEnforce).toBe(false);
      expect(s.blockers.join('\n')).toContain('…0001');

      // not enough volume is also not ready
      s = await admin().summary(7, 50);
      expect(s.coverage.find((c) => c.wabaId === W2)).toMatchObject({ verdict: 'not_ready' });
    });

    it('with nothing registered it says so', async () => {
      const s = await admin().summary();
      expect(s.readyToEnforce).toBe(false);
      expect(s.blockers.join('\n')).toContain('no registered Meta app has a secret');
    });
  });

  describe('discovery request validation', () => {
    it('apply must be a real boolean: the string "false" is read as false, and "yes" or 1 are refused (never silently switched on)', async () => {
      const root = await platformAdmin('SUPER_ADMIN');
      const url = '/platform-admin/whatsapp-webhook-security/discover';
      await api().post(url).set(root.auth).send({ apply: 'yes' }).expect(400);
      await api().post(url).set(root.auth).send({ apply: 1 }).expect(400);
    });
  });

  describe('discovery (Meta is faked; nothing leaves the test)', () => {
    function withFake(results: Record<string, SubscribedAppsResult>) {
      const client = { list: jest.fn(async (waba: string) => results[waba] ?? { ok: false as const, status: 400, code: 100, message: 'missing' }) } as unknown as MetaSubscribedAppsClient;
      return { client, svc: new WebhookSecurityAdminService(app.get(PrismaService), app.get(CredentialsEncryptionService), app.get(WhatsappWebhookSignatureService), client) };
    }

    it('a dry run changes nothing; apply maps only apps that are already registered and reports the rest', async () => {
      const t1 = await workspace('Tenant One', W1);
      await admin().upsertApp(APP1, { label: 'App One', secret: S1 });
      const { svc, client } = withFake({ [W1]: { ok: true, apps: [{ appId: APP1, name: 'One', overrideCallbackHost: null }, { appId: '3333333333', name: 'Unknown', overrideCallbackHost: 'cb.example.com' }] } });

      const dry = await svc.discover(undefined, false);
      expect(await testPrisma.whatsappWabaApp.count()).toBe(0);
      expect(dry.results[0]).toMatchObject({ status: 'ok', applied: false, mappedToRegisteredApps: [APP1], unregisteredApps: [{ appId: '3333333333' }], overrideCallbackHosts: ['cb.example.com'] });

      await svc.discover(t1.id, true);
      const rows = await testPrisma.whatsappWabaApp.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tenantId: t1.id, wabaId: W1, source: 'discovered' });
      expect(await testPrisma.whatsappMetaApp.count()).toBe(1); // the unknown app was NOT registered
      expect((client.list as jest.Mock).mock.calls[0]).toEqual([W1, 'tenant-token-placeholder']);
    });

    it('a failed lookup is reported with the status and code only, never the token', async () => {
      await workspace('Tenant Two', W2);
      const { svc } = withFake({ [W2]: { ok: false, status: 400, code: 100, message: "Object with ID '<n>' does not exist" } });
      const out = await svc.discover(undefined, true);
      expect(out.results[0]).toMatchObject({ status: 'lookup_failed', httpStatus: 400, metaCode: 100 });
      expect(JSON.stringify(out)).not.toContain('tenant-token-placeholder');
      expect(await testPrisma.whatsappWabaApp.count()).toBe(0);
    });
  });
});
