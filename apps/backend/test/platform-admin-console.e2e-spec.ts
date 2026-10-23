import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { AppModule } from '../src/app.module';
import { signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * The platform-admin API as the new admin console uses it: who may do what, what gets recorded, and whether the
 * directory, attention and detail endpoints return what the screens show. The app is built with the same strict
 * ValidationPipe as production (main.ts), because several rules here are request validation.
 */
describe('Platform admin console API (e2e)', () => {
  let app: INestApplication;
  const PASSWORD = 'correct-horse-battery-staple';
  const day = 86_400_000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
  });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });

  const api = () => request(app.getHttpServer());

  async function admin(role: 'SUPER_ADMIN' | 'SUPPORT' | 'VIEWER') {
    const row = await testPrisma.platformAdmin.create({
      data: { email: `${role.toLowerCase()}@example.com`, name: `${role} Admin`, role, passwordHash: await bcrypt.hash(PASSWORD, 4) },
    });
    const token = app.get(JwtService).sign(
      { sub: row.id, role: 'platform_admin', adminRole: role, email: row.email },
      { secret: process.env.JWT_SECRET ?? 'changeme', expiresIn: '1h' },
    );
    return { row, auth: { Authorization: `Bearer ${token}` } };
  }

  async function seedTenants() {
    const pro = await testPrisma.plan.create({ data: { slug: 'pro', name: 'Pro', monthlyPrice: 25, yearlyPrice: 250 } });
    const starter = await testPrisma.plan.create({ data: { slug: 'starter', name: 'Starter', monthlyPrice: 16, yearlyPrice: 160 } });
    const now = new Date();
    const sub = (tenantId: string, planId: string, status: 'ACTIVE' | 'TRIAL' | 'PAST_DUE', extra: Record<string, unknown> = {}) =>
      testPrisma.subscription.create({ data: { tenantId, planId, status, cycle: 'MONTHLY', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * day), ...extra } });
    const tenant = (name: string, createdAt: string, extra: Record<string, unknown> = {}) =>
      testPrisma.tenant.create({ data: { name, webhookVerifyToken: name, createdAt: new Date(createdAt), ...extra } });

    const alpha = await tenant('Alpha Foods', '2026-09-05T10:00:00Z');
    const beta = await tenant('Beta Shop', '2026-09-20T10:00:00Z', { isActive: false });
    const gamma = await tenant('Gamma Ltd', '2026-10-01T10:00:00Z');
    const evil = await tenant('=HYPERLINK("http://example.com","click")', '2026-10-02T10:00:00Z');
    await sub(alpha.id, pro.id, 'ACTIVE');
    await sub(gamma.id, starter.id, 'TRIAL', { trialEndsAt: new Date(now.getTime() + 3 * day) });
    await sub(evil.id, pro.id, 'PAST_DUE');
    return { alpha, beta, gamma, evil, pro, starter };
  }

  describe('who may call what', () => {
    it('refuses a missing token (401) and a tenant user token (403) on the new endpoints', async () => {
      const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
      const tenantToken = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
      for (const path of ['/platform-admin/attention', '/platform-admin/growth', `/platform-admin/users/${user.id}`, '/platform-admin/users']) {
        await api().get(path).expect(401);
        await api().get(path).set('Authorization', `Bearer ${tenantToken}`).expect(403);
      }
    });

    it('lets a VIEWER read but not change anything', async () => {
      const { tenants } = { tenants: await seedTenants() };
      const viewer = await admin('VIEWER');
      await api().get('/platform-admin/workspaces').set(viewer.auth).expect(200);
      await api().get('/platform-admin/attention').set(viewer.auth).expect(200);
      await api().patch(`/platform-admin/workspaces/${tenants.alpha.id}/suspend`).set(viewer.auth).send({ reason: 'testing' }).expect(403);
      await api().post(`/platform-admin/workspaces/${tenants.alpha.id}/credits/grant`).set(viewer.auth).send({ credits: 10, description: 'test grant' }).expect(403);
      expect((await testPrisma.tenant.findUnique({ where: { id: tenants.alpha.id } }))?.isActive).toBe(true);
    });

    it('lets SUPPORT suspend a tenant but not grant credits or force a plan (SUPER_ADMIN only)', async () => {
      const t = await seedTenants();
      const support = await admin('SUPPORT');
      await api().patch(`/platform-admin/workspaces/${t.alpha.id}/suspend`).set(support.auth).send({ reason: 'chargeback dispute' }).expect(200);
      await api().post(`/platform-admin/workspaces/${t.alpha.id}/credits/grant`).set(support.auth).send({ credits: 10, description: 'goodwill credit' }).expect(403);
      await api().patch(`/platform-admin/workspaces/${t.alpha.id}/force-plan`).set(support.auth).send({ planSlug: 'pro', reason: 'comp account' }).expect(403);
    });
  });

  describe('privileged actions are validated and recorded', () => {
    it('refuses to suspend without a reason, and records the reason when given', async () => {
      const t = await seedTenants();
      const support = await admin('SUPPORT');
      await api().patch(`/platform-admin/workspaces/${t.alpha.id}/suspend`).set(support.auth).send({}).expect(400);
      expect((await testPrisma.tenant.findUnique({ where: { id: t.alpha.id } }))?.isActive).toBe(true);

      await api().patch(`/platform-admin/workspaces/${t.alpha.id}/suspend`).set(support.auth).send({ reason: 'abuse report #41' }).expect(200);
      const log = await testPrisma.platformAuditLog.findFirst({ where: { action: 'workspace.suspend', resourceId: t.alpha.id } });
      expect(log?.adminId).toBe(support.row.id);
      expect(log?.metadata).toMatchObject({ reason: 'abuse report #41' });
    });

    it('requires a reason to suspend a user but not to restore one, and audits both with distinct actions', async () => {
      const { tenant, user } = await createTenantWithUser({ role: UserRole.AGENT });
      const support = await admin('SUPPORT');
      await api().patch(`/platform-admin/users/${user.id}/toggle-active`).set(support.auth).send({}).expect(400);
      expect((await testPrisma.user.findUnique({ where: { id: user.id } }))?.isActive).toBe(true);

      await api().patch(`/platform-admin/users/${user.id}/toggle-active`).set(support.auth).send({ reason: 'left the company' }).expect(200);
      await api().patch(`/platform-admin/users/${user.id}/toggle-active`).set(support.auth).send({}).expect(200);
      const actions = (await testPrisma.platformAuditLog.findMany({ where: { resourceId: user.id }, orderBy: { createdAt: 'asc' } })).map((l) => l.action);
      expect(actions).toEqual(['user.suspend', 'user.restore']);
      expect(tenant.id).toBeTruthy();
    });

    it('limits a credit grant to a sensible size and demands a description', async () => {
      const t = await seedTenants();
      const root = await admin('SUPER_ADMIN');
      const grant = (body: Record<string, unknown>) => api().post(`/platform-admin/workspaces/${t.alpha.id}/credits/grant`).set(root.auth).send(body);
      await grant({ credits: 1_000_001, description: 'typo' }).expect(400);
      await grant({ credits: 0, description: 'nothing' }).expect(400);
      await grant({ credits: 50, description: '' }).expect(400);
      await grant({ credits: 50, description: 'ok', extra: 'x' }).expect(400);
      await grant({ credits: 50, description: 'goodwill credit' }).expect(201);
      const log = await testPrisma.platformAuditLog.findFirst({ where: { action: 'workspace.grant_credits' } });
      expect(log?.metadata).toMatchObject({ credits: 50 });
    });

    it('requires a reason to override a plan, and refuses an unknown plan', async () => {
      const t = await seedTenants();
      const root = await admin('SUPER_ADMIN');
      const force = (body: Record<string, unknown>) => api().patch(`/platform-admin/workspaces/${t.gamma.id}/force-plan`).set(root.auth).send(body);
      await force({ planSlug: 'pro' }).expect(400);
      await force({ planSlug: 'nope', reason: 'comp account' }).expect(404);
      await force({ planSlug: 'pro', reason: 'comp account' }).expect(200);
      const log = await testPrisma.platformAuditLog.findFirst({ where: { action: 'workspace.force_plan' } });
      expect(log?.metadata).toMatchObject({ planSlug: 'pro', reason: 'comp account' });
    });
  });

  describe('admin sign-in', () => {
    it('audits a successful sign-in and every kind of failure, without saying which kind to the caller', async () => {
      const root = await admin('SUPER_ADMIN');
      const wrong = await api().post('/platform-admin/auth/login').send({ email: root.row.email, password: 'wrong-password' }).expect(401);
      const unknown = await api().post('/platform-admin/auth/login').send({ email: 'nobody@example.com', password: 'whatever-it-is' }).expect(401);
      expect(wrong.body.message).toBe(unknown.body.message);
      await testPrisma.platformAdmin.update({ where: { id: root.row.id }, data: { isActive: false } });
      await api().post('/platform-admin/auth/login').send({ email: root.row.email, password: PASSWORD }).expect(401);
      await testPrisma.platformAdmin.update({ where: { id: root.row.id }, data: { isActive: true } });
      await api().post('/platform-admin/auth/login').send({ email: root.row.email, password: PASSWORD }).expect(201);

      const logs = await testPrisma.platformAuditLog.findMany({ where: { action: { startsWith: 'auth.' } }, orderBy: { createdAt: 'asc' } });
      expect(logs.map((l) => [l.action, (l.metadata as { reason?: string } | null)?.reason ?? null])).toEqual([
        ['auth.login_failed', 'wrong_password'],
        ['auth.login_failed', 'unknown_account'],
        ['auth.login_failed', 'account_disabled'],
        ['auth.login', null],
      ]);
      expect(logs[1].adminId).toBeNull();
      expect(JSON.stringify(logs)).not.toContain('nobody@example.com');
      expect(JSON.stringify(logs)).not.toContain(PASSWORD);
    });

    it('rejects a weak or malformed password reset before touching any account', async () => {
      await api().post('/platform-admin/auth/reset-password').send({ token: 'a'.repeat(40), password: 'short' }).expect(400);
      await api().post('/platform-admin/auth/reset-password').send({ token: 'a'.repeat(40) }).expect(400);
      await api().post('/platform-admin/auth/reset-password').send({ token: 'x', password: 'long-enough-password-1' }).expect(400);
      await api().post('/platform-admin/auth/forgot-password').send({ email: 'not-an-email' }).expect(400);
    });
  });

  describe('tenant directory', () => {
    it('filters by status, plan, active switch and signup dates in the database, with a correct total', async () => {
      await seedTenants();
      const root = await admin('VIEWER');
      const list = async (qs: string) => (await api().get(`/platform-admin/workspaces?${qs}`).set(root.auth).expect(200)).body as { tenants: Array<{ name: string; status: string }>; total: number };

      expect((await list('status=suspended')).tenants.map((t) => t.name)).toEqual(['Beta Shop']);
      expect((await list('status=past_due')).total).toBe(1);
      expect((await list('status=trial')).tenants.map((t) => t.name)).toEqual(['Gamma Ltd']);
      expect((await list('plan=pro')).total).toBe(2);
      expect((await list('plan=starter')).tenants.map((t) => t.name)).toEqual(['Gamma Ltd']);
      expect((await list('active=false')).tenants.map((t) => t.name)).toEqual(['Beta Shop']);
      expect((await list('createdFrom=2026-09-10&createdTo=2026-10-01')).tenants.map((t) => t.name).sort()).toEqual(['Beta Shop', 'Gamma Ltd']);
      expect((await list('filter=trial_ending_7d')).tenants.map((t) => t.name)).toEqual(['Gamma Ltd']);
      expect((await list('search=alpha')).tenants.map((t) => t.name)).toEqual(['Alpha Foods']);
      expect((await list('status=churned')).total).toBe(0);
    });

    it('pages and sorts in the database without losing or repeating a row', async () => {
      await seedTenants();
      const root = await admin('VIEWER');
      const page = async (offset: number) => (await api().get(`/platform-admin/workspaces?limit=2&offset=${offset}&sort=name&order=asc`).set(root.auth).expect(200)).body as { tenants: Array<{ name: string }>; total: number };
      const first = await page(0), second = await page(2), third = await page(4);
      expect(first.total).toBe(4);
      expect([...first.tenants, ...second.tenants].map((t) => t.name)).toEqual(['=HYPERLINK("http://example.com","click")', 'Alpha Foods', 'Beta Shop', 'Gamma Ltd']);
      expect(third.tenants).toEqual([]);
    });

    it('gives the same answer from the full-scan path as from the database path', async () => {
      await seedTenants();
      const root = await admin('VIEWER');
      const fast = (await api().get('/platform-admin/workspaces?sort=name&order=asc&limit=50').set(root.auth).expect(200)).body.tenants.map((t: { id: string }) => t.id);
      const slow = (await api().get('/platform-admin/workspaces?sort=healthScore&order=desc&limit=50').set(root.auth).expect(200)).body.tenants.map((t: { id: string }) => t.id);
      expect([...slow].sort()).toEqual([...fast].sort());
    });

    it('rejects unknown filter values and over-large pages', async () => {
      const root = await admin('VIEWER');
      await api().get('/platform-admin/workspaces?status=bogus').set(root.auth).expect(400);
      await api().get('/platform-admin/workspaces?limit=5000').set(root.auth).expect(400);
      await api().get('/platform-admin/workspaces?createdFrom=yesterday').set(root.auth).expect(400);
    });

    it('stops a tenant name from being run as a spreadsheet formula in the CSV export', async () => {
      await seedTenants();
      const root = await admin('VIEWER');
      const csv = (await api().get('/platform-admin/workspaces/export').set(root.auth).expect(200)).text;
      expect(csv).toContain(`"'=HYPERLINK(""http://example.com"",""click"")"`);
      expect(csv.split('\n').some((line) => line.startsWith('=HYPERLINK'))).toBe(false);
    });
  });

  describe('tenant detail', () => {
    it('never sends secrets to the browser, and reports channel health from recorded facts', async () => {
      const t = await seedTenants();
      await testPrisma.tenant.update({ where: { id: t.alpha.id }, data: { accessToken: 'EAAB-TENANT-WHATSAPP-TOKEN', webhookVerifyToken: 'VERIFY-SECRET-VALUE', phoneNumberId: '123' } });
      const messenger = await testPrisma.channel.create({ data: { tenantId: t.alpha.id, type: 'FACEBOOK_MESSENGER', name: 'Alpha page', externalId: 'page-1', credentials: { token: 'CHANNEL-CREDENTIAL-SECRET' } } });
      await testPrisma.facebookPageConnection.create({
        data: { tenantId: t.alpha.id, channelId: messenger.id, pageId: 'page-1', pageName: 'Alpha page', pageAccessToken: 'PAGE-ACCESS-TOKEN-SECRET', webhookVerified: false, pageAccessTokenExpiresAt: new Date(Date.now() - 86_400_000) },
      });
      const qr = await testPrisma.channel.create({ data: { tenantId: t.alpha.id, type: 'WHATSAPP_WEB', name: 'Shop phone', externalId: 'qr-1' } });
      await testPrisma.whatsAppWebSession.create({ data: { tenantId: t.alpha.id, channelId: qr.id, status: 'LOGGED_OUT', phoneNumber: '+233200000000', encryptedAuthState: 'AUTH-STATE-SECRET' } });
      await testPrisma.payment.create({ data: { tenantId: t.alpha.id, gateway: 'PAYSTACK', status: 'FAILED', amount: 25, gatewayWebhookData: { authorization: { last4: '4081', bank: 'SECRET BANK' } } } as never });
      await testPrisma.errorLog.create({ data: { tenantId: t.alpha.id, service: 'backend', severity: 'ERROR', message: 'tenant error', fingerprint: 'tenant-fp' } });
      const viewer = await admin('VIEWER');

      const { body } = await api().get(`/platform-admin/workspaces/${t.alpha.id}`).set(viewer.auth).expect(200);
      const text = JSON.stringify(body);
      for (const secret of ['EAAB-TENANT-WHATSAPP-TOKEN', 'VERIFY-SECRET-VALUE', 'CHANNEL-CREDENTIAL-SECRET', 'PAGE-ACCESS-TOKEN-SECRET', 'AUTH-STATE-SECRET', 'SECRET BANK', '4081']) {
        expect(text).not.toContain(secret);
      }
      expect(body).not.toHaveProperty('accessToken');
      expect(body).not.toHaveProperty('webhookVerifyToken');

      const byName = Object.fromEntries(body.channels.map((c: { name: string }) => [c.name, c]));
      expect(byName['Alpha page'].health.state).toBe('attention');
      expect(byName['Alpha page'].health.reasons).toEqual(expect.arrayContaining(['The page access token has expired', 'Meta has not verified the webhook']));
      expect(byName['Shop phone'].health).toMatchObject({ state: 'disconnected', reasons: ['The phone logged this device out'] });
      expect(byName['Shop phone'].phoneNumber).toBe('+233200000000');
      expect(body.issues).toEqual({ openErrors: 1, failedWebhooks7d: 0, failedPayments30d: 1 });
      expect(body.payments[0]).not.toHaveProperty('gatewayWebhookData');
    });
  });

  describe('attention required', () => {
    it('is empty, with every check clear, for a healthy platform', async () => {
      await createTenantWithUser({ role: UserRole.ADMIN });
      const viewer = await admin('VIEWER');
      const { body } = await api().get('/platform-admin/attention').set(viewer.auth).expect(200);
      expect(body.items).toEqual([]);
      expect(body.checks.every((c: { clear: boolean }) => c.clear)).toBe(true);
      expect(body.notChecked.length).toBeGreaterThan(0);
    });

    it('reports only what the records show, with counts and destinations', async () => {
      const t = await seedTenants();
      await testPrisma.payment.create({ data: { tenantId: t.alpha.id, gateway: 'PAYSTACK', status: 'FAILED', amount: 25 } as never });
      await testPrisma.errorLog.create({ data: { service: 'backend', severity: 'CRITICAL', message: 'boom', fingerprint: 'fp-1' } });
      await testPrisma.errorLog.create({ data: { service: 'backend', severity: 'CRITICAL', message: 'old and resolved', fingerprint: 'fp-2', status: 'RESOLVED' } });
      const viewer = await admin('VIEWER');
      const { body } = await api().get('/platform-admin/attention').set(viewer.auth).expect(200);
      const byId = Object.fromEntries(body.items.map((i: { id: string }) => [i.id, i]));
      expect(byId['past-due'].count).toBe(1);
      expect(byId['trials-ending'].count).toBe(1);
      expect(byId['failed-payments'].count).toBe(1);
      expect(byId['critical-errors'].count).toBe(1); // the resolved one is not counted
      expect(byId['critical-errors'].severity).toBe('critical');
      expect(byId['past-due'].href).toBe('/platform-admin/workspaces?status=past_due');
      expect(body.items[0].severity).toBe('critical');
    });

    it('counts a suspended tenant\'s past-due subscription as nobody\'s problem', async () => {
      const t = await seedTenants();
      await testPrisma.tenant.update({ where: { id: t.evil.id }, data: { isActive: false } });
      const viewer = await admin('VIEWER');
      const { body } = await api().get('/platform-admin/attention').set(viewer.auth).expect(200);
      expect(body.items.find((i: { id: string }) => i.id === 'past-due')).toBeUndefined();
    });
  });

  describe('user directory and detail', () => {
    it('never returns a password hash or token, and shows memberships and audit history', async () => {
      const { tenant, user } = await createTenantWithUser({ role: UserRole.AGENT });
      const other = await testPrisma.tenant.create({ data: { name: 'Second Workspace', webhookVerifyToken: 'second' } });
      await testPrisma.workspaceMember.create({ data: { workspaceId: tenant.id, userId: user.id, role: 'AGENT', status: 'ACTIVE' } });
      await testPrisma.workspaceMember.create({ data: { workspaceId: other.id, userId: user.id, role: 'ADMIN', status: 'ACTIVE' } });
      const support = await admin('SUPPORT');
      await api().patch(`/platform-admin/users/${user.id}/toggle-active`).set(support.auth).send({ reason: 'security review' }).expect(200);

      const { body } = await api().get(`/platform-admin/users/${user.id}`).set(support.auth).expect(200);
      expect(body.id).toBe(user.id);
      expect(body.memberships.map((m: { workspace: { name: string }; role: string }) => [m.workspace.name, m.role]).sort()).toEqual([[tenant.name, 'AGENT'], ['Second Workspace', 'ADMIN']].sort());
      expect(body.audit[0]).toMatchObject({ action: 'user.suspend' });
      expect(body.audit[0].metadata).toMatchObject({ reason: 'security review' });
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/passwordHash|password_hash|not-a-real-hash|refreshToken|resetToken/);
    });

    it('404s for an unknown user and filters the list by role, status and text', async () => {
      const a = await createTenantWithUser({ role: UserRole.ADMIN });
      const b = await createTenantWithUser({ role: UserRole.AGENT });
      await testPrisma.user.update({ where: { id: b.user.id }, data: { isActive: false } });
      const viewer = await admin('VIEWER');
      await api().get('/platform-admin/users/00000000-0000-0000-0000-000000000000').set(viewer.auth).expect(404);
      const ids = async (qs: string) => (await api().get(`/platform-admin/users?${qs}`).set(viewer.auth).expect(200)).body.users.map((u: { id: string }) => u.id);
      expect(await ids('status=suspended')).toEqual([b.user.id]);
      expect(await ids('status=active')).toEqual([a.user.id]);
      expect(await ids('role=AGENT')).toEqual([b.user.id]);
      expect(await ids(`search=${encodeURIComponent(a.tenant.name)}`)).toEqual([a.user.id]); // matches the tenant name too
      expect(await ids(`search=${b.user.id}`)).toEqual([b.user.id]);
    });
  });

  describe('AI usage totals', () => {
    it('totals every tenant, not just the 20 listed', async () => {
      const root = await admin('VIEWER');
      for (let i = 0; i < 22; i++) {
        const tenant = await testPrisma.tenant.create({ data: { name: `AI tenant ${i}`, webhookVerifyToken: `ai-${i}` } });
        await testPrisma.aiCreditTransaction.create({ data: { tenantId: tenant.id, type: 'AI_USAGE', credits: -10, balanceAfter: 0, description: 'usage' } });
      }
      const today = new Date().toISOString().slice(0, 10);
      const { body } = await api().get(`/platform-admin/ai/usage?from=${today}&to=${today}`).set(root.auth).expect(200);
      expect(body.items).toHaveLength(20);
      expect(body.totals).toEqual({ creditsConsumed: 220, aiCalls: 22, tenants: 22 });
    });
  });

  describe('growth and audit trail', () => {
    it('returns the rollup series with real totals, and flags a stale rollup', async () => {
      await testPrisma.platformDailyStats.create({ data: { date: new Date('2026-03-10'), totalTenants: 10, newTenants: 2, activeSubscriptions: 4, mrrGhs: 1200 } });
      await testPrisma.platformDailyStats.create({ data: { date: new Date('2026-03-11'), totalTenants: 11, newTenants: 1, activeSubscriptions: 5, mrrGhs: 1500 } });
      const viewer = await admin('VIEWER');
      const { body } = await api().get('/platform-admin/growth?from=2026-03-01&to=2026-03-31').set(viewer.auth).expect(200);
      expect(body.series.map((s: { date: string }) => s.date)).toEqual(['2026-03-10', '2026-03-11']);
      expect(body.totals.newTenants).toBe(3);
      expect(body.rollup).toMatchObject({ latestDate: '2026-03-11', daysWithData: 2 });
      expect(body.rollup.stale).toBe(true); // the range ends 20 days after the last rollup
    });

    it('filters the audit trail by action prefix, admin, resource and dates', async () => {
      const t = await seedTenants();
      const root = await admin('SUPER_ADMIN');
      await api().patch(`/platform-admin/workspaces/${t.alpha.id}/suspend`).set(root.auth).send({ reason: 'abuse report' }).expect(200);
      await api().patch(`/platform-admin/workspaces/${t.alpha.id}/activate`).set(root.auth).send({}).expect(200);
      await api().post('/platform-admin/auth/login').send({ email: root.row.email, password: 'wrong-password' }).expect(401);
      const list = async (qs: string) => (await api().get(`/platform-admin/audit-logs?${qs}`).set(root.auth).expect(200)).body as { items: Array<{ action: string }>; total: number };

      expect((await list('action=workspace')).items.map((i) => i.action).sort()).toEqual(['workspace.activate', 'workspace.suspend']);
      expect((await list('action=workspace.suspend')).total).toBe(1);
      expect((await list('action=auth.login_failed')).total).toBe(1);
      expect((await list(`resourceId=${t.alpha.id}`)).total).toBe(2);
      expect((await list('q=super_admin')).total).toBeGreaterThanOrEqual(2);
      const today = new Date().toISOString().slice(0, 10);
      expect((await list(`from=${today}&to=${today}`)).total).toBe(3);
      expect((await list('from=2020-01-01&to=2020-01-02')).total).toBe(0);
    });

  // Last on purpose: it uses up the sign-in allowance for this address, so no later test can sign in.
  describe('rate limiting', () => {
    it('rate-limits repeated sign-in attempts from one address', async () => {
      let limited = 0;
      for (let i = 0; i < 14; i++) {
        const res = await api().post('/platform-admin/auth/login').send({ email: 'x@example.com', password: 'wrong-password' });
        if (res.status === 429) limited++;
      }
      expect(limited).toBeGreaterThan(0);
    });
  });
  });
});
