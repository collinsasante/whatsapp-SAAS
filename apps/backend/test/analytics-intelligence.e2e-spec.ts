import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * Seeds one small, fully known workspace and asserts exact values, so a change to any definition (what counts as a
 * first reply, a paid order, an AI hand-off) fails here instead of silently moving a number on the dashboard.
 *
 * Timezone: Africa/Accra is UTC+0, so UTC timestamps below fall on the dates written. 2026-03-10 is a Tuesday.
 */
describe('GET /analytics/intelligence (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await createTestingApp(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });

  const at = (iso: string) => new Date(iso);

  async function seedWorkspace() {
    const { tenant, user: admin } = await createTenantWithUser({ role: UserRole.ADMIN });
    const ama = await testPrisma.user.create({
      data: { tenantId: tenant.id, name: 'Ama', email: `ama-${tenant.id}@example.com`, passwordHash: 'x', role: UserRole.AGENT, isActive: true },
    });
    const verz = await testPrisma.user.create({
      data: { tenantId: tenant.id, name: 'Verz AI', email: `ai-${tenant.id}@example.com`, passwordHash: 'x', role: UserRole.AGENT, isActive: true, isAiAgent: true },
    });
    const messenger = await testPrisma.channel.create({
      data: { tenantId: tenant.id, type: 'FACEBOOK_MESSENGER', name: 'Page', externalId: 'page-1' },
    });
    const contact = (phone: string, name: string, createdAt: string) =>
      testPrisma.contact.create({ data: { tenantId: tenant.id, phone, name, createdAt: at(createdAt) } });
    const c1 = await contact('+233200000001', 'Kojo', '2026-03-10T09:00:00Z');
    const c2 = await contact('+233200000002', 'Efua', '2026-03-10T10:30:00Z');
    const c4 = await contact('+233200000004', 'Old customer', '2026-02-10T08:00:00Z');
    const evalContact = await testPrisma.contact.create({
      data: { tenantId: tenant.id, phone: '+233200000009', name: 'Eval', isEvalContact: true, createdAt: at('2026-03-10T09:00:00Z') },
    });

    const conv = (data: Record<string, unknown>) =>
      testPrisma.conversation.create({ data: { tenantId: tenant.id, ...data } as never });

    // conv1: WhatsApp, answered by a person after 10 minutes, resolved after 2 hours, rated 5.
    const conv1 = await conv({
      contactId: c1.id, status: 'RESOLVED', assignedToId: ama.id, labels: ['pricing'],
      createdAt: at('2026-03-10T10:00:00Z'), resolvedAt: at('2026-03-10T12:00:00Z'),
      csatScore: 5, csatSubmittedAt: at('2026-03-10T12:05:00Z'), slaDeadline: at('2026-03-10T11:00:00Z'),
    });
    // conv2: WhatsApp, answered by Verz AI after 60 seconds and resolved with no person involved.
    const conv2 = await conv({
      contactId: c2.id, status: 'RESOLVED', labels: [],
      createdAt: at('2026-03-10T11:00:00Z'), resolvedAt: at('2026-03-10T11:30:00Z'),
    });
    // conv3: Messenger, the same customer as conv1 (returning), unanswered and unassigned, escalated by the AI.
    const conv3 = await conv({
      contactId: c1.id, status: 'OPEN', channelId: messenger.id, labels: ['pricing', 'delivery'],
      createdAt: at('2026-03-12T09:00:00Z'), slaDeadline: at('2026-03-12T09:30:00Z'), slaBreached: true,
    });
    // Previous period: one resolved conversation.
    await conv({
      contactId: c4.id, status: 'RESOLVED', createdAt: at('2026-02-10T10:00:00Z'), resolvedAt: at('2026-02-10T11:00:00Z'),
    });
    // Must be excluded everywhere: an evaluation-harness conversation.
    const evalConv = await conv({
      contactId: evalContact.id, status: 'OPEN', contactSource: 'eval_harness', createdAt: at('2026-03-10T10:00:00Z'),
    });

    // Also excluded: the dashboard's own test chat, including an order placed from it.
    const testConv = await conv({
      contactId: c2.id, status: 'OPEN', contactSource: 'dashboard_test', createdAt: at('2026-03-11T10:00:00Z'),
    });

    const msg = (data: Record<string, unknown>) =>
      testPrisma.message.create({ data: { tenantId: tenant.id, status: 'SENT', ...data } as never });
    await msg({ conversationId: conv1.id, contactId: c1.id, direction: 'INBOUND', createdAt: at('2026-03-10T10:00:00Z') });
    await msg({ conversationId: conv1.id, contactId: c1.id, direction: 'OUTBOUND', senderId: ama.id, createdAt: at('2026-03-10T10:10:00Z') });
    await msg({ conversationId: conv2.id, contactId: c2.id, direction: 'INBOUND', createdAt: at('2026-03-10T11:00:00Z') });
    await msg({ conversationId: conv2.id, contactId: c2.id, direction: 'OUTBOUND', senderId: verz.id, createdAt: at('2026-03-10T11:01:00Z') });
    await msg({ conversationId: conv3.id, contactId: c1.id, direction: 'INBOUND', createdAt: at('2026-03-12T09:00:00Z') });
    await msg({ conversationId: testConv.id, contactId: c2.id, direction: 'INBOUND', createdAt: at('2026-03-11T10:00:00Z') });
    await msg({ conversationId: evalConv.id, contactId: evalContact.id, direction: 'INBOUND', createdAt: at('2026-03-10T10:00:00Z') });

    await testPrisma.lead.create({
      data: { tenantId: tenant.id, contactId: c1.id, conversationId: conv1.id, status: 'CONVERTED', productInterest: 'Shoes', createdAt: at('2026-03-10T10:05:00Z') },
    });
    await testPrisma.lead.create({
      data: { tenantId: tenant.id, contactId: c1.id, conversationId: conv3.id, status: 'HOT', productInterest: 'shoes ', createdAt: at('2026-03-12T09:05:00Z') },
    });

    const order = (data: Record<string, unknown>) => testPrisma.order.create({
      data: { tenantId: tenant.id, contactId: c1.id, customerPhone: '+233200000001', subtotalMajorUnits: 0, ...data } as never,
    });
    await order({ conversationId: conv1.id, status: 'PAID', currency: 'GHS', totalMajorUnits: 150, paidAt: at('2026-03-10T11:30:00Z') });
    await order({ conversationId: testConv.id, status: 'PAID', currency: 'GHS', totalMajorUnits: 500, paidAt: at('2026-03-11T10:30:00Z') });
    await order({ status: 'COMPLETED', currency: 'USD', totalMajorUnits: 50, paidAt: at('2026-03-15T10:00:00Z') });
    await order({ status: 'CANCELLED', currency: 'GHS', totalMajorUnits: 999, paidAt: null });
    await order({ status: 'PAID', currency: 'GHS', totalMajorUnits: 777, isEvalOrder: true, paidAt: at('2026-03-10T11:30:00Z') });

    const log = (data: Record<string, unknown>) => testPrisma.aiInteractionLog.create({
      data: { tenantId: tenant.id, customerMessage: 'q', aiResponse: 'a', ...data } as never,
    });
    await log({ conversationId: conv2.id, status: 'AUTO_SENT', confidenceScore: 0.9, createdAt: at('2026-03-10T11:01:00Z') });
    await log({ conversationId: conv1.id, status: 'APPROVED', confidenceScore: 0.7, createdAt: at('2026-03-10T10:05:00Z') });
    await log({ conversationId: conv3.id, status: 'REJECTED', confidenceScore: 0.5, createdAt: at('2026-03-12T09:05:00Z') });
    await testPrisma.conversationEvent.create({
      data: { tenantId: tenant.id, conversationId: conv3.id, type: 'REQUESTED', createdAt: at('2026-03-12T09:30:00Z') },
    });

    return { tenant, admin, ama, verz, conv1, conv2, conv3 };
  }

  const get = (app: INestApplication, token: string, qs: string) =>
    request(app.getHttpServer()).get(`/analytics/intelligence?${qs}`).set('Authorization', `Bearer ${token}`);
  const adminToken = (a: INestApplication, w: { tenant: { id: string }; admin: { id: string; email: string } }) =>
    signTestToken(a, { sub: w.admin.id, email: w.admin.email, tenantId: w.tenant.id, role: UserRole.ADMIN });

  const RANGE = 'from=2026-03-01&to=2026-03-31';

  it('computes conversation, response-time and resolution measures exactly, excluding evaluation and test-chat data', async () => {
    const w = await seedWorkspace();
    const { body } = await get(app, adminToken(app, w), RANGE).expect(200);

    expect(body.meta).toMatchObject({ from: '2026-03-01', to: '2026-03-31', previousFrom: '2026-01-29', previousTo: '2026-02-28', days: 31, channel: 'ALL' });
    expect(body.current.conversations).toEqual({ total: 3, newContact: 2, returningContact: 1 });
    expect(body.previous.conversations.total).toBe(1);
    expect(body.current.resolved).toBe(2);
    expect(body.current.newContacts).toBe(2); // Kojo and Efua; the eval contact is excluded
    expect(body.current.activeContacts).toBe(2);
    expect(body.current.inboundMessages).toBe(3);

    // First reply: conv1 took 600s (person), conv2 took 60s (Verz AI), conv3 has no reply.
    expect(body.current.firstResponse.samples).toBe(2);
    expect(body.current.firstResponse.medianSeconds).toBe(330);
    expect(body.current.firstResponse.human).toMatchObject({ samples: 1, medianSeconds: 600 });
    expect(body.current.firstResponse.buckets.map((b: { count: number }) => b.count)).toEqual([1, 1, 0, 0, 0]);

    expect(body.current.resolution).toMatchObject({ samples: 2, medianSeconds: 4500 });
    expect(body.current.sla).toEqual({ tracked: 2, breached: 1 });
    expect(body.current.csat).toEqual({ responses: 1, average: 5 });
  });

  it('reports leads, paid orders per currency (never mixed) and the conversation-to-order conversion inputs', async () => {
    const w = await seedWorkspace();
    const { body } = await get(app, adminToken(app, w), RANGE).expect(200);

    expect(body.current.leads).toEqual({ created: 2, qualified: 2, converted: 1 });
    // Spellings that differ only by case or spaces are one product; the most recent spelling is shown.
    expect(body.productInterest).toEqual([{ product: 'shoes', leads: 2 }]);

    const byCurrency = Object.fromEntries(body.current.orders.byCurrency.map((o: { currency: string }) => [o.currency, o]));
    expect(byCurrency.GHS).toMatchObject({ paidOrders: 1, revenue: 150 }); // cancelled, eval and test-chat orders excluded
    expect(byCurrency.USD).toMatchObject({ paidOrders: 1, revenue: 50 });
    expect(body.current.orders.conversationsWithPaidOrder).toBe(1);
    expect(body.coverage).toEqual({ orders: true, leads: true, ai: true, sla: true, csat: true });
  });

  it('separates Verz AI replies and suggestions from people, and counts a hand-off only after the AI engaged', async () => {
    const w = await seedWorkspace();
    const { body } = await get(app, adminToken(app, w), RANGE).expect(200);

    expect(body.current.ai).toMatchObject({
      engagedConversations: 3, autoReplies: 1, suggestions: 2, suggestionsSent: 1, suggestionsRejected: 1,
      handedToPerson: 1, resolvedWithoutPerson: 1,
    });
    // The Verz AI user must never appear as an agent.
    expect(body.agents.map((a: { name: string }) => a.name)).toEqual(['Ama']);
    expect(body.agents[0]).toMatchObject({ assigned: 1, resolved: 1, csat: { responses: 1, average: 5 } });
    expect(body.agents[0].firstResponse).toMatchObject({ samples: 1, medianSeconds: 600 });
  });

  it('builds the backlog snapshot, heatmap, daily series with the previous-period overlay, topics and channels', async () => {
    const w = await seedWorkspace();
    const { body } = await get(app, adminToken(app, w), RANGE).expect(200);

    expect(body.backlog).toMatchObject({ open: 1, unassigned: 1, awaitingReply: 1, awaitingReplyOverHour: 1, slaBreached: 1 });
    expect(body.backlog.waiting).toHaveLength(1);
    expect(body.backlog.waiting[0]).toMatchObject({ conversationId: w.conv3.id, channel: 'FACEBOOK_MESSENGER', contactName: 'Kojo' });

    const slot = (dayOfWeek: number, hour: number) => body.heatmap.find((h: { dayOfWeek: number; hour: number }) => h.dayOfWeek === dayOfWeek && h.hour === hour)?.count;
    expect(slot(2, 10)).toBe(1); // Tuesday 10:00
    expect(slot(2, 11)).toBe(1);
    expect(slot(4, 9)).toBe(1); // Thursday 09:00

    expect(body.series).toHaveLength(31);
    const day = (d: string) => body.series.find((p: { date: string }) => p.date === d);
    expect(day('2026-03-10')).toMatchObject({ opened: 2, resolved: 2, newContacts: 2, inbound: 2 });
    expect(day('2026-03-12')).toMatchObject({ opened: 1, inbound: 1 });
    // The previous period starts 2026-01-29, so 2026-02-10 is its 13th day (index 12) and lines up with 2026-03-13.
    expect(day('2026-03-13').previousOpened).toBe(1);
    expect(day('2026-03-12').previousOpened).toBe(0);

    expect(body.topics.rows[0]).toMatchObject({ label: 'pricing', conversations: 2, unresolved: 1 });
    expect(body.topics.labelledConversations).toBe(2);
    expect(body.topics.totalConversations).toBe(3);

    const channel = (c: string) => body.channels.find((r: { channel: string }) => r.channel === c);
    expect(channel('WHATSAPP')).toMatchObject({ conversations: 2, previousConversations: 1, qualifiedLeads: 1, paidOrders: 1 });
    expect(channel('FACEBOOK_MESSENGER')).toMatchObject({ conversations: 1, qualifiedLeads: 1, paidOrders: 0 });
  });

  it('applies the channel filter to every measure, including orders that belong to another channel', async () => {
    const w = await seedWorkspace();
    const { body } = await get(app, adminToken(app, w), `${RANGE}&channel=FACEBOOK_MESSENGER`).expect(200);

    expect(body.meta.channel).toBe('FACEBOOK_MESSENGER');
    expect(body.current.conversations.total).toBe(1);
    expect(body.current.resolved).toBe(0);
    expect(body.current.orders.byCurrency).toEqual([]);
    expect(body.current.leads.created).toBe(1);
    expect(body.current.ai.creditsUsed).toBeNull();
    expect(body.backlog.open).toBe(1);
  });

  it('resolves presets in the workspace timezone and rejects unknown channels', async () => {
    const w = await seedWorkspace();
    const res = await get(app, adminToken(app, w), 'preset=7d').expect(200);
    expect(res.body.meta.days).toBe(7);
    expect(res.body.meta.to >= res.body.meta.from).toBe(true);
    await get(app, adminToken(app, w), 'channel=TELEGRAM').expect(400);
  });

  it('is admin-only and never leaks another workspace', async () => {
    const w = await seedWorkspace();
    const other = await createTenantWithUser({ role: UserRole.ADMIN });

    const agentToken = signTestToken(app, { sub: w.ama.id, email: w.ama.email, tenantId: w.tenant.id, role: UserRole.AGENT });
    await get(app, agentToken, RANGE).expect(403);
    await request(app.getHttpServer()).get(`/analytics/intelligence?${RANGE}`).expect(401);

    const { body } = await get(app, adminToken(app, { tenant: other.tenant, admin: other.user }), RANGE).expect(200);
    expect(body.current.conversations.total).toBe(0);
    expect(body.current.orders.byCurrency).toEqual([]);
    expect(body.backlog.open).toBe(0);
    expect(body.agents).toEqual([]);
    expect(body.coverage.orders).toBe(false);
  });
});
