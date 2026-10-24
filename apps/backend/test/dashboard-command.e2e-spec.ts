import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * Seeds one small, fully known workspace and asserts the exact numbers each owner-dashboard widget returns, plus the
 * boundaries that matter: tenant isolation, role enforcement, range validation and workspace-timezone day edges.
 * Africa/Accra is UTC+0 (no settings row), so UTC timestamps fall on the dates written.
 */
describe('GET /dashboard/command/* (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await createTestingApp({ validation: true }); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });

  const at = (iso: string) => new Date(iso);
  const RANGE = 'preset=custom&from=2026-03-01&to=2026-03-31';

  async function seedWorkspace(opts: { timezone?: string; name?: string } = {}) {
    const { tenant, user: admin } = await createTenantWithUser({ role: UserRole.ADMIN, tenantName: opts.name });
    if (opts.timezone) await testPrisma.tenantSettings.create({ data: { tenantId: tenant.id, timezone: opts.timezone } });
    const mk = (data: Record<string, unknown>) =>
      testPrisma.user.create({ data: { tenantId: tenant.id, passwordHash: 'x', isActive: true, ...data } as never });
    const ama = await mk({ name: 'Ama', email: `ama-${tenant.id}@example.com`, role: UserRole.AGENT });
    const verz = await mk({ name: 'Verz AI', email: `ai-${tenant.id}@example.com`, role: UserRole.AGENT, isAiAgent: true });
    const messenger = await testPrisma.channel.create({
      data: { tenantId: tenant.id, type: 'FACEBOOK_MESSENGER', name: 'Shop page', externalId: `page-${tenant.id}` },
    });
    const contact = (phone: string, name: string, createdAt: string, extra: Record<string, unknown> = {}) =>
      testPrisma.contact.create({ data: { tenantId: tenant.id, phone: `${phone}${tenant.id.slice(0, 4)}`, name, createdAt: at(createdAt), ...extra } });
    const kojo = await contact('+2332000001', 'Kojo', '2026-03-10T09:00:00Z');
    const efua = await contact('+2332000002', 'Efua', '2026-03-10T10:30:00Z');
    const yaw = await contact('+2332000005', 'Yaw', '2026-03-12T09:30:00Z');
    const old = await contact('+2332000004', 'Old customer', '2026-02-10T08:00:00Z');
    const evalContact = await contact('+2332000009', 'Eval', '2026-03-10T09:00:00Z', { isEvalContact: true });

    const conv = (data: Record<string, unknown>) => testPrisma.conversation.create({ data: { tenantId: tenant.id, ...data } as never });
    const conv1 = await conv({ contactId: kojo.id, status: 'RESOLVED', assignedToId: ama.id, createdAt: at('2026-03-10T10:00:00Z'), resolvedAt: at('2026-03-10T12:00:00Z') });
    const conv2 = await conv({ contactId: efua.id, status: 'RESOLVED', createdAt: at('2026-03-10T11:00:00Z'), resolvedAt: at('2026-03-10T11:30:00Z') });
    // Returning customer on Messenger, asked for a person, past the reply deadline, nobody took it.
    const conv3 = await conv({
      contactId: kojo.id, status: 'REQUESTED', channelId: messenger.id,
      createdAt: at('2026-03-12T09:00:00Z'), slaDeadline: at('2026-03-12T09:30:00Z'), slaBreached: true,
    });
    // Assigned, and the only reply never reached the customer.
    const conv5 = await conv({ contactId: yaw.id, status: 'OPEN', assignedToId: ama.id, createdAt: at('2026-03-12T10:00:00Z') });
    await conv({ contactId: old.id, status: 'RESOLVED', createdAt: at('2026-02-10T10:00:00Z'), resolvedAt: at('2026-02-10T11:00:00Z') });
    const evalConv = await conv({ contactId: evalContact.id, status: 'OPEN', contactSource: 'eval_harness', createdAt: at('2026-03-10T10:00:00Z') });
    const testConv = await conv({ contactId: efua.id, status: 'OPEN', contactSource: 'dashboard_test', createdAt: at('2026-03-11T10:00:00Z') });

    const msg = (data: Record<string, unknown>) => testPrisma.message.create({ data: { tenantId: tenant.id, status: 'SENT', ...data } as never });
    await msg({ conversationId: conv1.id, contactId: kojo.id, direction: 'INBOUND', createdAt: at('2026-03-10T10:00:00Z') });
    await msg({ conversationId: conv1.id, contactId: kojo.id, direction: 'OUTBOUND', senderId: ama.id, createdAt: at('2026-03-10T10:10:00Z') });
    await msg({ conversationId: conv2.id, contactId: efua.id, direction: 'INBOUND', createdAt: at('2026-03-10T11:00:00Z') });
    await msg({ conversationId: conv2.id, contactId: efua.id, direction: 'OUTBOUND', senderId: verz.id, createdAt: at('2026-03-10T11:01:00Z') });
    await msg({ conversationId: conv3.id, contactId: kojo.id, direction: 'INBOUND', createdAt: at('2026-03-12T09:00:00Z') });
    await msg({ conversationId: conv5.id, contactId: yaw.id, direction: 'INBOUND', createdAt: at('2026-03-12T10:00:00Z') });
    await msg({ conversationId: conv5.id, contactId: yaw.id, direction: 'OUTBOUND', senderId: ama.id, status: 'FAILED', failedAt: at('2026-03-12T10:05:00Z'), createdAt: at('2026-03-12T10:05:00Z') });
    await msg({ conversationId: testConv.id, contactId: efua.id, direction: 'INBOUND', createdAt: at('2026-03-11T10:00:00Z') });
    await msg({ conversationId: evalConv.id, contactId: evalContact.id, direction: 'INBOUND', createdAt: at('2026-03-10T10:00:00Z') });

    const template = await testPrisma.template.create({ data: { tenantId: tenant.id, name: 'promo', language: 'en', status: 'APPROVED' } });
    await testPrisma.campaign.create({
      data: { tenantId: tenant.id, name: 'Easter promo', status: 'FAILED', templateId: template.id, createdById: admin.id, updatedAt: at('2026-03-20T10:00:00Z') },
    });
    await testPrisma.facebookPageConnection.create({
      data: {
        tenantId: tenant.id, channelId: messenger.id, pageId: `p-${tenant.id}`, pageName: 'Shop page', pageAccessToken: 'x',
        webhookVerified: true, lastError: 'Token invalid', lastErrorAt: new Date(),
      },
    });

    const recent = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    const event = (data: Record<string, unknown>) => testPrisma.conversationEvent.create({ data: { tenantId: tenant.id, ...data } as never });
    await event({ conversationId: conv3.id, type: 'REQUESTED', createdAt: recent(5) });
    await event({ conversationId: conv1.id, type: 'RESOLVED', actorId: ama.id, createdAt: recent(20) });
    await event({ conversationId: conv1.id, type: 'NOTE_ADDED', actorId: ama.id, payload: { text: 'private note text' }, createdAt: recent(2) });
    await event({ conversationId: evalConv.id, type: 'REQUESTED', createdAt: recent(1) });
    await event({ conversationId: conv2.id, type: 'RESOLVED', createdAt: at('2026-03-10T11:30:00Z') });

    const log = (data: Record<string, unknown>) => testPrisma.aiInteractionLog.create({ data: { tenantId: tenant.id, customerMessage: 'q', aiResponse: 'a', ...data } as never });
    await log({ conversationId: conv2.id, status: 'AUTO_SENT', confidenceScore: 0.9, createdAt: at('2026-03-10T11:01:00Z') });
    await log({ conversationId: conv3.id, status: 'REJECTED', confidenceScore: 0.5, createdAt: at('2026-03-12T09:05:00Z') });
    await testPrisma.conversationEvent.create({ data: { tenantId: tenant.id, conversationId: conv3.id, type: 'REQUESTED', createdAt: at('2026-03-12T09:30:00Z') } });
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { aiCredits: 42 } });
    await testPrisma.aiCreditTransaction.create({ data: { tenantId: tenant.id, type: 'AI_USAGE', credits: -3, balanceAfter: 42, description: 'use', createdAt: at('2026-03-10T11:01:00Z') } });

    return { tenant, admin, ama, conv1, conv2, conv3, conv5 };
  }

  const token = (a: INestApplication, w: { tenant: { id: string }; admin: { id: string; email: string } }, role = UserRole.ADMIN) =>
    signTestToken(a, { sub: w.admin.id, email: w.admin.email, tenantId: w.tenant.id, role });
  const get = (path: string, tkn: string, qs = RANGE) =>
    request(app.getHttpServer()).get(`/dashboard/command/${path}?${qs}`).set('Authorization', `Bearer ${tkn}`);

  it('summary: counts match the seeded workspace and exclude eval and test-chat data', async () => {
    const w = await seedWorkspace({ name: 'Kente Shop' });
    const { body } = await get('summary', token(app, w)).expect(200);

    expect(body.meta).toMatchObject({ workspaceName: 'Kente Shop', from: '2026-03-01', to: '2026-03-31', previousFrom: '2026-01-29', previousTo: '2026-02-28', days: 31, granularity: 'day' });
    expect(body.current.conversations).toEqual({ total: 4, newContact: 3, returningContact: 1 });
    expect(body.current.newCustomers).toBe(3);
    // A failed send is not a reply: conv5 has no first response, conv1 took 600s and conv2 60s.
    expect(body.current.firstResponse).toEqual({ samples: 2, medianSeconds: 330 });
    expect(body.current.resolution).toEqual({ opened: 4, resolved: 2, rate: 50 });
    expect(body.current.engagement).toEqual({ inbound: 4, outbound: 2 });
    expect(body.previous.conversations.total).toBe(1);
    expect(body.previous.resolution).toEqual({ opened: 1, resolved: 1, rate: 100 });
    expect(body.previous.firstResponse.medianSeconds).toBeNull();
    expect(body.coverage.orders).toBe(false);
    expect(body.current.orders.byCurrency).toEqual([]);
  });

  it('summary: returns nulls, not zeros, for rates and times in an empty period', async () => {
    const w = await seedWorkspace();
    const { body } = await get('summary', token(app, w), 'preset=custom&from=2025-01-01&to=2025-01-07').expect(200);
    expect(body.current.conversations.total).toBe(0);
    expect(body.current.resolution.rate).toBeNull();
    expect(body.current.firstResponse.medianSeconds).toBeNull();
  });

  it('trend: buckets by day with opened/resolved/messages and new vs returning, and the channel split', async () => {
    const w = await seedWorkspace();
    const { body } = await get('trend', token(app, w)).expect(200);
    expect(body.points).toHaveLength(31);
    const day = (d: string) => body.points.find((p: { bucket: string }) => p.bucket === d);
    expect(day('2026-03-10')).toMatchObject({ opened: 2, resolved: 2, inbound: 2, outbound: 2, newCustomers: 2, returningCustomers: 0 });
    expect(day('2026-03-12')).toMatchObject({ opened: 2, resolved: 0, inbound: 2, outbound: 0, newCustomers: 1, returningCustomers: 1 });
    const total = (k: string) => body.points.reduce((s: number, p: Record<string, number>) => s + p[k], 0);
    expect(total('opened')).toBe(4);
    const channel = (c: string) => body.channels.find((r: { channel: string }) => r.channel === c);
    expect(channel('WHATSAPP').conversations).toBe(3);
    expect(channel('FACEBOOK_MESSENGER').conversations).toBe(1);
  });

  it('trend: a single day is bucketed by hour in the workspace timezone, with exact day edges', async () => {
    const { tenant, user: admin } = await createTenantWithUser({ role: UserRole.ADMIN });
    await testPrisma.tenantSettings.create({ data: { tenantId: tenant.id, timezone: 'Pacific/Auckland' } });
    const k = await testPrisma.contact.create({ data: { tenantId: tenant.id, phone: '+64210000001', name: 'Hemi' } });
    // Auckland is UTC+13 on 2026-03-10: the local day runs 2026-03-09T11:00Z to 2026-03-10T11:00Z.
    for (const iso of ['2026-03-09T10:59:00Z', '2026-03-09T11:00:00Z', '2026-03-10T10:59:00Z', '2026-03-10T11:00:00Z']) {
      await testPrisma.conversation.create({ data: { tenantId: tenant.id, contactId: k.id, status: 'OPEN', createdAt: at(iso) } });
    }
    const { body } = await get('trend', token(app, { tenant, admin }), 'preset=custom&from=2026-03-10&to=2026-03-10').expect(200);
    expect(body.meta.granularity).toBe('hour');
    expect(body.meta.timezone).toBe('Pacific/Auckland');
    expect(body.points).toHaveLength(24);
    const count = (b: string) => body.points.find((p: { bucket: string }) => p.bucket === b).opened;
    expect(count('2026-03-10 00')).toBe(1); // 11:00Z = local midnight, included
    expect(count('2026-03-10 23')).toBe(1); // 10:59Z = 23:59 local, included
    expect(body.points.reduce((s: number, p: { opened: number }) => s + p.opened, 0)).toBe(2); // the two outside the day are excluded
  });

  it('attention: reports each problem with the count its linked view shows, and links that exist', async () => {
    const w = await seedWorkspace();
    const { body } = await get('attention', token(app, w)).expect(200);
    const byKind = Object.fromEntries(body.items.map((i: { kind: string }) => [i.kind, i]));

    expect(byKind.requests).toMatchObject({ count: 1, href: '/inbox?status=REQUESTED' });
    expect(byKind.sla_breached).toMatchObject({ count: 1 });
    expect(byKind.unassigned).toMatchObject({ count: 1, href: '/inbox?status=ACTIVE&assignee=unassigned' });
    expect(byKind.awaiting_reply).toMatchObject({ count: 1, href: '/inbox?status=UNREPLIED' });
    expect(byKind.awaiting_reply.samples[0]).toMatchObject({ conversationId: w.conv3.id, contactName: 'Kojo' });
    expect(byKind.failed_deliveries).toMatchObject({ count: 1, href: `/inbox?c=${w.conv5.id}` });
    expect(byKind.failed_campaigns).toMatchObject({ count: 1 });
    expect(byKind.channel_problems).toMatchObject({ count: 1 });
    expect(body.items[0].severity).toBe('critical');
    expect(body.notChecked).toEqual([]);
  });

  it('attention: says a check was not run when reply deadlines were never used', async () => {
    const { tenant, user: admin } = await createTenantWithUser({ role: UserRole.ADMIN });
    const { body } = await get('attention', token(app, { tenant, admin })).expect(200);
    expect(body.items).toEqual([]);
    expect(body.notChecked.map((n: { kind: string }) => n.kind)).toEqual(['sla_breached']);
    expect(body.checked).not.toContain('sla_breached');
  });

  it('team: lists people alphabetically with their own workload, never the AI user', async () => {
    const w = await seedWorkspace();
    const { body } = await get('team', token(app, w)).expect(200);
    expect(body.agents.map((a: { name: string }) => a.name)).toEqual(['Ama']);
    expect(body.agents[0]).toMatchObject({ assigned: 2, resolved: 1, openNow: 1 });
    expect(body.agents[0].firstResponse).toMatchObject({ samples: 1, medianSeconds: 600 });
    expect(body.workload).toEqual({ open: 2, unassigned: 1 });
  });

  it('ai: separates AI activity, hand-offs and credits, and never calls an AI message a resolution on its own', async () => {
    const w = await seedWorkspace();
    const { body } = await get('ai', token(app, w)).expect(200);
    expect(body.credits).toEqual({ balance: 42, usedCurrent: 3, usedPrevious: 0 });
    expect(body.current).toMatchObject({ engagedConversations: 2, autoReplies: 1, suggestions: 1, handedToPerson: 1, resolvedWithoutPerson: 1 });
    expect(body.coverage.ai).toBe(true);
    expect(body.enabled).toBe(false);
  });

  it('activity: returns recent events without any message or note content, and excludes test conversations', async () => {
    const w = await seedWorkspace();
    const res = await get('activity', token(app, w)).expect(200);
    const kinds = res.body.entries.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(['requested', 'resolved']); // newest first; the note and the eval-conversation event are excluded
    expect(res.body.entries[1]).toMatchObject({ actorName: 'Ama', contactName: 'Kojo', conversationId: w.conv1.id });
    expect(JSON.stringify(res.body)).not.toContain('private note text');
  });

  it('recommendations: every link points at a page that exists and each item carries evidence', async () => {
    const w = await seedWorkspace();
    const { body } = await get('recommendations', token(app, w)).expect(200);
    expect(Array.isArray(body.insights)).toBe(true);
    for (const i of body.insights) {
      expect(i.evidence.length).toBeGreaterThan(0);
      if (i.link) expect(i.link.href).toMatch(/^\/(inbox|analytics|contacts|campaigns|channels|commerce\/(orders|revenue)|ai|billing|settings)/);
    }
  });

  describe('security', () => {
    const paths = ['summary', 'trend', 'attention', 'team', 'ai', 'activity', 'recommendations'];

    it('rejects unauthenticated requests', async () => {
      for (const p of paths) await request(app.getHttpServer()).get(`/dashboard/command/${p}`).expect(401);
    });

    it('rejects agents on every widget (owner-only data)', async () => {
      const w = await seedWorkspace();
      const agentToken = signTestToken(app, { sub: w.ama.id, email: w.ama.email, tenantId: w.tenant.id, role: UserRole.AGENT });
      for (const p of paths) await get(p, agentToken).expect(403);
    });

    it("never returns another workspace's data, even when a tenantId is supplied in the query", async () => {
      const a = await seedWorkspace({ name: 'A' });
      const b = await seedWorkspace({ name: 'B' });
      const alone = (await get('summary', token(app, a)).expect(200)).body.current;
      const spoofed = await get('summary', token(app, a), `${RANGE}&tenantId=${b.tenant.id}`);
      expect(spoofed.status).toBe(400); // the global pipe forbids unknown query fields such as tenantId
      expect(alone.conversations.total).toBe(4); // not 8: B's conversations are not counted
      const attention = (await get('attention', token(app, a)).expect(200)).body;
      expect(JSON.stringify(attention)).not.toContain(b.conv3.id);
      const activity = (await get('activity', token(app, a)).expect(200)).body;
      expect(JSON.stringify(activity)).not.toContain(b.conv1.id);
      const teamNames = (await get('team', token(app, a)).expect(200)).body.agents.length;
      expect(teamNames).toBe(1);
    });

    it('validates the range', async () => {
      const w = await seedWorkspace();
      const t = token(app, w);
      await get('summary', t, 'preset=forever').expect(400);
      await get('summary', t, 'preset=custom&from=2026-03-01').expect(400);
      await get('summary', t, 'from=2026-03-10&to=2026-03-01').expect(400);
      await get('summary', t, 'from=2026-01-01&to=2026-12-31').expect(400);
      await get('summary', t, 'from=not-a-date&to=2026-03-01').expect(400);
      await get('summary', t, "from=2026-03-01';DROP TABLE users;--&to=2026-03-02").expect(400);
      await get('summary', t, 'preset=7d').expect(200);
    });
  });
});
