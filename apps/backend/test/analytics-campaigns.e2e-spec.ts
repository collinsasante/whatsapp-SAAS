import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

describe('GET /analytics/campaigns (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await createTestingApp(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });

  it('returns the campaign funnel counts and a failure breakdown mapped to human categories', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const template = await testPrisma.template.create({
      data: { tenantId: tenant.id, name: 'promo', language: 'en', status: 'APPROVED' },
    });

    const inRange = new Date('2026-03-15T10:00:00.000Z');
    const campaign = await testPrisma.campaign.create({
      data: {
        tenantId: tenant.id, name: 'March Promo', templateId: template.id, createdById: user.id,
        totalRecipients: 10, sentCount: 10, deliveredCount: 8, readCount: 5, repliedCount: 2, failedCount: 2, clickCount: 3,
        createdAt: inRange,
      },
    });

    const contact1 = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000021' } });
    const contact2 = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000022' } });

    // One failure mapped to "not_on_whatsapp" (131026), one to "other" (unmapped code)
    await testPrisma.campaignRecipient.create({
      data: { campaignId: campaign.id, contactId: contact1.id, status: 'FAILED', errorCode: 131026 },
    });
    await testPrisma.campaignRecipient.create({
      data: { campaignId: campaign.id, contactId: contact2.id, status: 'FAILED', errorCode: 999999 },
    });

    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    const res = await request(app.getHttpServer())
      .get('/analytics/campaigns?from=2026-03-01&to=2026-03-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.campaigns).toHaveLength(1);
    const c = res.body.campaigns[0];
    expect(c.name).toBe('March Promo');
    expect(c.sentCount).toBe(10);
    expect(c.deliveredCount).toBe(8);
    expect(c.readCount).toBe(5);
    expect(c.repliedCount).toBe(2);
    expect(c.clickCount).toBe(3);

    const categories = c.failureBreakdown.map((f: { category: string; count: number }) => [f.category, f.count]);
    expect(categories).toEqual(expect.arrayContaining([
      ['not_on_whatsapp', 1],
      ['other', 1],
    ]));
  });

  it('computes per-template delivery and read rates across all of the tenant\'s campaigns using that template', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const template = await testPrisma.template.create({ data: { tenantId: tenant.id, name: 'reminder', language: 'en', status: 'APPROVED' } });

    await testPrisma.campaign.create({
      data: { tenantId: tenant.id, name: 'Reminder 1', templateId: template.id, createdById: user.id, sentCount: 100, deliveredCount: 50, readCount: 25, createdAt: new Date('2026-01-01') },
    });
    await testPrisma.campaign.create({
      data: { tenantId: tenant.id, name: 'Reminder 2', templateId: template.id, createdById: user.id, sentCount: 100, deliveredCount: 50, readCount: 25, createdAt: new Date('2026-03-15') },
    });

    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    const res = await request(app.getHttpServer())
      .get('/analytics/campaigns?from=2026-03-01&to=2026-03-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Template performance aggregates across ALL campaigns using it, not just those in the requested page/range
    const tmpl = res.body.templatePerformance.find((t: { name: string }) => t.name === 'reminder');
    expect(tmpl.sentCount).toBe(200);
    expect(tmpl.deliveryRate).toBeCloseTo(50, 1); // 100/200
    expect(tmpl.readRate).toBeCloseTo(50, 1); // 50/100
    expect(tmpl.approvalStatus).toBe('APPROVED');
  });
});

describe('GET /analytics/revenue and /analytics/health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await createTestingApp(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });

  it('/analytics/revenue is forbidden for an AGENT-role requester', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.AGENT });
    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.AGENT });
    await request(app.getHttpServer())
      .get('/analytics/revenue?from=2026-03-01&to=2026-03-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('/analytics/revenue breaks amounts down by gateway for an ADMIN requester', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const inRange = new Date('2026-03-10');
    await testPrisma.payment.create({ data: { tenantId: tenant.id, gateway: 'STRIPE', status: 'SUCCEEDED', amount: 25, verifiedAt: inRange, createdAt: inRange } });
    await testPrisma.payment.create({ data: { tenantId: tenant.id, gateway: 'PAYSTACK', status: 'SUCCEEDED', amount: 10, verifiedAt: inRange, createdAt: inRange } });

    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    const res = await request(app.getHttpServer())
      .get('/analytics/revenue?from=2026-03-01&to=2026-03-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.totalAmount).toBe(35);
    const stripe = res.body.byGateway.find((g: { gateway: string }) => g.gateway === 'STRIPE');
    expect(stripe.amount).toBe(25);
  });

  it('/analytics/health flags a spike when blocks/opt-outs more than double week over week', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const now = Date.now();
    const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

    // Previous 7 days: 1 block. Last 7 days: 5 blocks (> 2x)
    await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000030', isBlocked: true, blockedAt: daysAgo(10) } });
    for (let i = 0; i < 5; i++) {
      await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: `+23320000004${i}`, isBlocked: true, blockedAt: daysAgo(1) } });
    }

    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    const res = await request(app.getHttpServer())
      .get('/analytics/health')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.optOuts.last7Days).toBe(5);
    expect(res.body.optOuts.previous7Days).toBe(1);
    expect(res.body.optOuts.spike).toBe(true);
  });
});
