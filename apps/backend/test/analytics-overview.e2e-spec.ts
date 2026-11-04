import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase, pinClock, unpinClock } from './utils/test-db';

describe('GET /analytics/overview (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await createTestingApp(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });
  afterEach(() => unpinClock());

  it('returns exact message counts and rates for seeded messages within the requested range', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const contact = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000001', name: 'Test Contact' } });
    const conversation = await testPrisma.conversation.create({ data: { tenantId: tenant.id, contactId: contact.id, status: 'OPEN' } });

    pinClock('2026-03-15T12:00:00.000Z');       // the seeded day is "today", so the live path counts it (past days come from worker rollups)
    const inRange = new Date('2026-03-15T10:00:00.000Z'); // Africa/Accra has no offset, so this date is unambiguous
    const outOfRange = new Date('2026-04-01T10:00:00.000Z');

    // 3 outbound messages sent in-range, 2 delivered, 1 read
    for (let i = 0; i < 3; i++) {
      await testPrisma.message.create({
        data: {
          tenantId: tenant.id, conversationId: conversation.id, contactId: contact.id,
          direction: 'OUTBOUND', status: 'SENT', createdAt: inRange, sentAt: inRange,
          deliveredAt: i < 2 ? inRange : null,
          readAt: i < 1 ? inRange : null,
        },
      });
    }
    // 4 inbound messages in-range ("replied" == inbound volume, see analytics.util note)
    for (let i = 0; i < 4; i++) {
      await testPrisma.message.create({
        data: { tenantId: tenant.id, conversationId: conversation.id, contactId: contact.id, direction: 'INBOUND', status: 'DELIVERED', createdAt: inRange },
      });
    }
    // 1 outbound message outside the requested range -- must not be counted
    await testPrisma.message.create({
      data: { tenantId: tenant.id, conversationId: conversation.id, contactId: contact.id, direction: 'OUTBOUND', status: 'SENT', createdAt: outOfRange, sentAt: outOfRange },
    });

    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    const res = await request(app.getHttpServer())
      .get('/analytics/overview?from=2026-03-01&to=2026-03-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.messages.sent).toBe(3);
    expect(res.body.messages.delivered).toBe(2);
    expect(res.body.messages.read).toBe(1);
    expect(res.body.messages.replied).toBe(4);
    expect(res.body.messages.deliveryRate).toBeCloseTo((2 / 3) * 100, 1);
  });

  it('serves PAST days from the daily rollups the worker writes, and only that tenant\'s', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const other = await createTenantWithUser({ role: UserRole.ADMIN });
    const row = (tenantId: string, date: string, n: number) => ({ tenantId, date: new Date(`${date}T00:00:00.000Z`), sentCount: n, deliveredCount: n - 1, readCount: 1, inboundCount: n * 2, outboundCount: n });
    await testPrisma.analyticsDailyMessageStats.createMany({ data: [row(tenant.id, '2026-03-10', 5), row(tenant.id, '2026-03-11', 3), row(tenant.id, '2026-04-20', 99), row(other.tenant.id, '2026-03-10', 1000)] });
    await testPrisma.analyticsDailyRevenueStats.createMany({ data: [
      { tenantId: tenant.id, date: new Date('2026-03-10T00:00:00.000Z'), gateway: 'STRIPE', successCount: 2, failedCount: 1, amount: 40, updatedAt: new Date() },
      { tenantId: other.tenant.id, date: new Date('2026-03-10T00:00:00.000Z'), gateway: 'STRIPE', successCount: 9, failedCount: 0, amount: 9999, updatedAt: new Date() },
    ] });
    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    const res = await request(app.getHttpServer()).get('/analytics/overview?from=2026-03-01&to=2026-03-31').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.messages).toMatchObject({ sent: 8, delivered: 6, read: 2, replied: 16 });     // 5+3 only: not April, not the other tenant
    expect(res.body.revenue).toMatchObject({ amount: 40, successCount: 2, failedCount: 1 });
  });

  it('sums successful payment amounts for the period and excludes failed ones from the revenue total', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    pinClock('2026-03-10T12:00:00.000Z');
    const inRange = new Date('2026-03-10T10:00:00.000Z');

    await testPrisma.payment.create({
      data: { tenantId: tenant.id, gateway: 'STRIPE', status: 'SUCCEEDED', amount: 25, verifiedAt: inRange, createdAt: inRange },
    });
    await testPrisma.payment.create({
      data: { tenantId: tenant.id, gateway: 'PAYSTACK', status: 'SUCCEEDED', amount: 15, verifiedAt: inRange, createdAt: inRange },
    });
    await testPrisma.payment.create({
      data: { tenantId: tenant.id, gateway: 'STRIPE', status: 'FAILED', amount: 25, createdAt: inRange },
    });

    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    const res = await request(app.getHttpServer())
      .get('/analytics/overview?from=2026-03-01&to=2026-03-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.revenue.amount).toBe(40);
    expect(res.body.revenue.successCount).toBe(2);
    expect(res.body.revenue.failedCount).toBe(1);
  });

  it('omits revenue entirely for an AGENT-role requester (role-based access)', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.AGENT });
    await testPrisma.payment.create({
      data: { tenantId: tenant.id, gateway: 'STRIPE', status: 'SUCCEEDED', amount: 100, verifiedAt: new Date('2026-03-10'), createdAt: new Date('2026-03-10') },
    });

    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.AGENT });
    const res = await request(app.getHttpServer())
      .get('/analytics/overview?from=2026-03-01&to=2026-03-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.scope).toBe('agent');
    expect(res.body.revenue).toBeNull();
  });

  it('scopes an AGENT requester\'s conversation counts to only conversations assigned to them', async () => {
    const { tenant, user: agent } = await createTenantWithUser({ role: UserRole.AGENT });

    const otherUser = await testPrisma.user.create({
      data: { tenantId: tenant.id, name: 'Other Agent', email: 'other@example.com', passwordHash: 'x', role: UserRole.AGENT, isActive: true },
    });

    const inRange = new Date('2026-03-10T10:00:00.000Z');
    const contact1 = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000010' } });
    const contact2 = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000011' } });

    await testPrisma.conversation.create({ data: { tenantId: tenant.id, contactId: contact1.id, status: 'OPEN', assignedToId: agent.id, createdAt: inRange } });
    await testPrisma.conversation.create({ data: { tenantId: tenant.id, contactId: contact2.id, status: 'OPEN', assignedToId: otherUser.id, createdAt: inRange } });

    const token = signTestToken(app, { sub: agent.id, email: agent.email, tenantId: tenant.id, role: UserRole.AGENT });
    const res = await request(app.getHttpServer())
      .get('/analytics/overview?from=2026-03-01&to=2026-03-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.conversations.total).toBe(1); // only the one assigned to `agent`, not the other agent's
  });

  it('rejects a date range longer than 366 days', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    await request(app.getHttpServer())
      .get('/analytics/overview?from=2020-01-01&to=2026-01-01')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
