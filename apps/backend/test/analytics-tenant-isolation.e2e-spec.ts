import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

describe('Analytics tenant isolation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestingApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function seedConversations(tenantId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const contact = await testPrisma.contact.create({
        data: { tenantId, phone: `+233000000${i}`, name: `Contact ${i}` },
      });
      await testPrisma.conversation.create({
        data: { tenantId, contactId: contact.id, status: 'OPEN' },
      });
    }
  }

  it('tenant A cannot see tenant B\'s conversation counts, and vice versa', async () => {
    const { tenant: tenantA, user: userA } = await createTenantWithUser({ role: UserRole.ADMIN });
    const { tenant: tenantB, user: userB } = await createTenantWithUser({ role: UserRole.ADMIN });

    await seedConversations(tenantA.id, 5);
    await seedConversations(tenantB.id, 2);

    const tokenA = signTestToken(app, { sub: userA.id, email: userA.email, tenantId: tenantA.id, role: UserRole.ADMIN });
    const tokenB = signTestToken(app, { sub: userB.id, email: userB.email, tenantId: tenantB.id, role: UserRole.ADMIN });

    const resA = await request(app.getHttpServer())
      .get('/analytics/overview')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(resA.body.conversations.total).toBe(5);

    const resB = await request(app.getHttpServer())
      .get('/analytics/overview')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(resB.body.conversations.total).toBe(2);
  });

  it('a spoofed x-tenant-id header cannot override the tenant encoded in a valid JWT', async () => {
    const { tenant: tenantA, user: userA } = await createTenantWithUser({ role: UserRole.ADMIN });
    const { tenant: tenantB } = await createTenantWithUser({ role: UserRole.ADMIN });

    await seedConversations(tenantA.id, 3);
    await seedConversations(tenantB.id, 9);

    const tokenA = signTestToken(app, { sub: userA.id, email: userA.email, tenantId: tenantA.id, role: UserRole.ADMIN });

    const res = await request(app.getHttpServer())
      .get('/analytics/overview')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-tenant-id', tenantB.id) // attempt to spoof a different tenant
      .expect(200);

    // Must still reflect tenant A's data (3), never tenant B's (9)
    expect(res.body.conversations.total).toBe(3);
  });

  it('rejects requests with no token at all', async () => {
    await request(app.getHttpServer()).get('/analytics/overview').expect(401);
  });
});
