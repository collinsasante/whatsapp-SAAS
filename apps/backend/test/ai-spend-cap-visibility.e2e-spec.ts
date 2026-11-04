import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/** What a workspace may see about its AI spend cap through the real route: its own numbers, admins only, never another workspace's. */
describe('AI spend cap visibility (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestingApp(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(resetTestDatabase);

  async function workspace(cap: number, spent: number) {
    const { tenant, user } = await createTenantWithUser();
    await testPrisma.tenantSettings.create({ data: { tenantId: tenant.id, aiDailyCreditCap: cap, aiCapWarnPercent: 60 } });
    await testPrisma.aiCreditTransaction.create({ data: { tenantId: tenant.id, type: 'AI_USAGE', credits: -spent, balanceAfter: 0, description: 'test' } });
    const agent = await testPrisma.user.create({ data: { tenantId: tenant.id, name: 'Agent', email: `agent-${tenant.id}@example.com`, passwordHash: 'x', role: 'AGENT', isActive: true } });
    const token = (u: { id: string; email: string }, role: UserRole) => `Bearer ${signTestToken(app, { sub: u.id, email: u.email, tenantId: tenant.id, role })}`;
    return { tenant, admin: token(user, UserRole.ADMIN), agent: token(agent, UserRole.AGENT) };
  }
  const usage = (auth: string) => request(app.getHttpServer()).get('/billing/credits/usage').set('Authorization', auth);

  it('shows an admin their own cap, usage, warning level, state and reset time', async () => {
    const a = await workspace(1000, 700);
    const r = await usage(a.admin).expect(200);
    expect(r.body).toMatchObject({ dailyCreditCap: 1000, spentToday: 700, capWarnPercent: 60, capState: 'WARNING', percentOfCapUsed: 70, capTimezone: expect.any(String) });
    expect(new Date(r.body.capResetsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not show spend or cap to an agent', async () => {
    const a = await workspace(1000, 700);
    await usage(a.agent).expect(403);
  });

  it('never includes another workspace\'s numbers', async () => {
    const a = await workspace(1000, 700); const b = await workspace(50, 49);
    const mine = (await usage(a.admin).expect(200)).body;
    const theirs = (await usage(b.admin).expect(200)).body;
    expect(mine).toMatchObject({ dailyCreditCap: 1000, spentToday: 700 });
    expect(theirs).toMatchObject({ dailyCreditCap: 50, spentToday: 49, capState: 'WARNING' });
    expect(JSON.stringify(mine)).not.toContain(b.tenant.id);
  });

  it('keeps the platform-wide spend list away from workspace users', async () => {
    const a = await workspace(1000, 700);
    for (const auth of [a.admin, a.agent]) {
      await request(app.getHttpServer()).get('/platform-admin/ai/spend-caps').set('Authorization', auth).expect((r) => expect([401, 403]).toContain(r.status));
      await request(app.getHttpServer()).patch(`/platform-admin/workspaces/${a.tenant.id}/ai-daily-credit-cap`).set('Authorization', auth).send({ cap: 5000 }).expect((r) => expect([401, 403]).toContain(r.status));
    }
    expect((await testPrisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: a.tenant.id } })).aiDailyCreditCap).toBe(1000);
  });
});
