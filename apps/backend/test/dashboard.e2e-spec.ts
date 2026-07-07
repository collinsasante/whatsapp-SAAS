import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

describe('GET /dashboard (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await createTestingApp(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });

  function tokenFor(app: INestApplication, tenantId: string, user: { id: string; email: string }, role: UserRole) {
    return signTestToken(app, { sub: user.id, email: user.email, tenantId, role });
  }

  describe('tenant isolation', () => {
    it('tenant A cannot see tenant B\'s unassigned conversation counts', async () => {
      const { tenant: tenantA, user: userA } = await createTenantWithUser({ role: UserRole.ADMIN });
      const { tenant: tenantB, user: userB } = await createTenantWithUser({ role: UserRole.ADMIN });

      const contactA = await testPrisma.contact.create({ data: { tenantId: tenantA.id, phone: '+233200000001' } });
      await testPrisma.conversation.create({ data: { tenantId: tenantA.id, contactId: contactA.id, status: 'OPEN' } });

      const contactB1 = await testPrisma.contact.create({ data: { tenantId: tenantB.id, phone: '+233200000002' } });
      const contactB2 = await testPrisma.contact.create({ data: { tenantId: tenantB.id, phone: '+233200000003' } });
      await testPrisma.conversation.create({ data: { tenantId: tenantB.id, contactId: contactB1.id, status: 'OPEN' } });
      await testPrisma.conversation.create({ data: { tenantId: tenantB.id, contactId: contactB2.id, status: 'REQUESTED' } });

      const resA = await request(app.getHttpServer())
        .get('/dashboard')
        .set('Authorization', `Bearer ${tokenFor(app, tenantA.id, userA, UserRole.ADMIN)}`)
        .expect(200);
      expect(resA.body.needsAttention.unassigned.count).toBe(1);

      const resB = await request(app.getHttpServer())
        .get('/dashboard')
        .set('Authorization', `Bearer ${tokenFor(app, tenantB.id, userB, UserRole.ADMIN)}`)
        .expect(200);
      expect(resB.body.needsAttention.unassigned.count).toBe(2);
    });

    it('a spoofed x-tenant-id header cannot override the tenant encoded in a valid JWT', async () => {
      const { tenant: tenantA, user: userA } = await createTenantWithUser({ role: UserRole.ADMIN });
      const { tenant: tenantB } = await createTenantWithUser({ role: UserRole.ADMIN });

      const contactB = await testPrisma.contact.create({ data: { tenantId: tenantB.id, phone: '+233200000009' } });
      await testPrisma.conversation.create({ data: { tenantId: tenantB.id, contactId: contactB.id, status: 'OPEN' } });

      const res = await request(app.getHttpServer())
        .get('/dashboard')
        .set('Authorization', `Bearer ${tokenFor(app, tenantA.id, userA, UserRole.ADMIN)}`)
        .set('x-tenant-id', tenantB.id)
        .expect(200);

      expect(res.body.needsAttention.unassigned.count).toBe(0);
    });

    it('rejects requests with no token at all', async () => {
      await request(app.getHttpServer()).get('/dashboard').expect(401);
    });
  });

  describe('role-based scope and redaction', () => {
    it('returns tenant-wide scope and revenue for an ADMIN', async () => {
      const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
      const now = new Date();
      await testPrisma.payment.create({
        data: { tenantId: tenant.id, gateway: 'STRIPE', status: 'SUCCEEDED', amount: 50, currency: 'GHS', verifiedAt: now, createdAt: now },
      });

      const res = await request(app.getHttpServer())
        .get('/dashboard')
        .set('Authorization', `Bearer ${tokenFor(app, tenant.id, user, UserRole.ADMIN)}`)
        .expect(200);

      expect(res.body.scope).toBe('tenant');
      expect(res.body.today.revenue).toEqual([{ currency: 'GHS', amount: 50, count: 1 }]);
      expect(res.body.setupChecklist).not.toBeNull();
    });

    it('omits revenue and the setup checklist for an AGENT, and scopes unassigned to none', async () => {
      const { tenant, user: agent } = await createTenantWithUser({ role: UserRole.AGENT });
      const now = new Date();
      await testPrisma.payment.create({
        data: { tenantId: tenant.id, gateway: 'STRIPE', status: 'SUCCEEDED', amount: 50, currency: 'GHS', verifiedAt: now, createdAt: now },
      });

      const res = await request(app.getHttpServer())
        .get('/dashboard')
        .set('Authorization', `Bearer ${tokenFor(app, tenant.id, agent, UserRole.AGENT)}`)
        .expect(200);

      expect(res.body.scope).toBe('agent');
      expect(res.body.today.revenue).toBeNull();
      expect(res.body.setupChecklist).toBeNull();
      // agents never see the tenant-wide unassigned queue -- they see their own assignments' health instead
      expect(res.body.needsAttention.unassigned.count).toBe(0);
    });

    it('scopes an AGENT\'s "today" conversation counts to only conversations assigned to them', async () => {
      const { tenant, user: agent } = await createTenantWithUser({ role: UserRole.AGENT });
      const otherAgent = await testPrisma.user.create({
        data: { tenantId: tenant.id, name: 'Other Agent', email: 'other@example.com', passwordHash: 'x', role: UserRole.AGENT, isActive: true },
      });

      const contact1 = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000021' } });
      const contact2 = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000022' } });
      const now = new Date();

      await testPrisma.conversation.create({ data: { tenantId: tenant.id, contactId: contact1.id, status: 'OPEN', assignedToId: agent.id, createdAt: now } });
      await testPrisma.conversation.create({ data: { tenantId: tenant.id, contactId: contact2.id, status: 'OPEN', assignedToId: otherAgent.id, createdAt: now } });

      const res = await request(app.getHttpServer())
        .get('/dashboard')
        .set('Authorization', `Bearer ${tokenFor(app, tenant.id, agent, UserRole.AGENT)}`)
        .expect(200);

      expect(res.body.today.newConversations.today).toBe(1);
    });
  });

  describe('needs attention', () => {
    it('flags a conversation whose 24h WhatsApp window is closing within 4 hours', async () => {
      const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
      const contact = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000030' } });
      const conversation = await testPrisma.conversation.create({ data: { tenantId: tenant.id, contactId: contact.id, status: 'OPEN' } });

      // last inbound message 21h ago -> 3h remaining in the 24h window
      const lastInboundAt = new Date(Date.now() - 21 * 60 * 60 * 1000);
      await testPrisma.message.create({
        data: { tenantId: tenant.id, conversationId: conversation.id, contactId: contact.id, direction: 'INBOUND', status: 'DELIVERED', createdAt: lastInboundAt },
      });

      const res = await request(app.getHttpServer())
        .get('/dashboard')
        .set('Authorization', `Bearer ${tokenFor(app, tenant.id, user, UserRole.ADMIN)}`)
        .expect(200);

      expect(res.body.needsAttention.windowClosingSoon.count).toBe(1);
      expect(res.body.needsAttention.windowClosingSoon.items[0].conversationId).toBe(conversation.id);
    });

    it('flags a conversation with a breached SLA deadline', async () => {
      const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
      const contact = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+233200000031' } });
      await testPrisma.conversation.create({
        data: {
          tenantId: tenant.id, contactId: contact.id, status: 'REQUESTED',
          slaDeadline: new Date(Date.now() - 60 * 60 * 1000), slaBreached: true,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/dashboard')
        .set('Authorization', `Bearer ${tokenFor(app, tenant.id, user, UserRole.ADMIN)}`)
        .expect(200);

      expect(res.body.needsAttention.slaBreaching.count).toBe(1);
    });
  });
});
