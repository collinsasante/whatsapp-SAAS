import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { ConversationsService } from '../src/conversations/conversations.service';
import { MetaPhoneStatusClient } from '../src/dashboard/meta-phone-status.client';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * Seeds one small, fully known workspace and asserts the exact numbers each owner-dashboard widget returns, plus the
 * boundaries that matter: tenant isolation, role enforcement, range validation and workspace-timezone day edges.
 * Africa/Accra is UTC+0 (no settings row), so UTC timestamps fall on the dates written.
 */
describe('GET /dashboard/command/* (e2e)', () => {
  let app: INestApplication;

  // Meta is never called from tests: this stub answers per phone-number id.
  const metaStub = {
    fetch: async (phoneNumberId: string) => {
      if (phoneNumberId === 'pn-good') {
        return { ok: true, data: { verified_name: 'Kente Shop', display_phone_number: '+233 20 000 0000', quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K', code_verification_status: 'VERIFIED', name_status: 'APPROVED', status: 'CONNECTED' } };
      }
      return { ok: false, kind: 'TOKEN_INVALID', message: 'Meta rejected the saved access token. Reconnect this number in Channels.' };
    },
  };

  beforeAll(async () => {
    app = await createTestingApp({
      validation: true,
      configure: (b) => b.overrideProvider(MetaPhoneStatusClient).useValue(metaStub),
    });
  });
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

  it('attention: runs the reply-deadline check by default and says so when the deadline is turned off', async () => {
    const { tenant, user: admin } = await createTenantWithUser({ role: UserRole.ADMIN });
    const on = (await get('attention', token(app, { tenant, admin })).expect(200)).body;
    expect(on.notChecked).toEqual([]);
    expect(on.checked).toContain('sla_breached');

    await testPrisma.tenantSettings.create({ data: { tenantId: tenant.id, replyDeadlineMinutes: null } });
    const off = (await get('attention', token(app, { tenant, admin })).expect(200)).body;
    expect(off.items).toEqual([]);
    expect(off.notChecked.map((n: { kind: string }) => n.kind)).toEqual(['sla_breached']);
    expect(off.checked).not.toContain('sla_breached');
  });

  it('requests: counts requests waiting for a person, the overdue ones, and the deadline in force', async () => {
    const w = await seedWorkspace();
    const { body } = await get('requests', token(app, w)).expect(200);
    expect(body).toMatchObject({ requesting: 1, overdue: 1, deadlineMinutes: 15 });
    expect(body.oldestWaitingSeconds).toBeGreaterThan(0);
    expect(body.samples).toHaveLength(1);
    expect(body.samples[0]).toMatchObject({ conversationId: w.conv3.id, contactName: 'Kojo', overdue: true });
  });

  it('business: shows the workspace details, the account and what is still missing, without secrets', async () => {
    const w = await seedWorkspace({ name: 'Kente Shop' });
    await testPrisma.tenantSettings.create({ data: { tenantId: w.tenant.id, businessName: 'Kente Shop Ltd', businessEmail: 'hi@kente.test', timezone: 'Africa/Accra' } });
    const { body } = await get('business', token(app, w)).expect(200);
    expect(body.business).toMatchObject({ name: 'Kente Shop Ltd', email: 'hi@kente.test', phone: null });
    expect(body.missing).toEqual(expect.arrayContaining(['phone', 'address', 'website', 'description']));
    expect(body.missing).not.toContain('email');
    expect(body.account).toMatchObject({ members: 2, channels: 1, timezone: 'Africa/Accra' }); // the Verz AI user is not a member
    expect(JSON.stringify(body)).not.toMatch(/accessToken|webhookVerifyToken|passwordHash/);
  });

  it('whatsapp-status: reports each connected number from Meta, falls back honestly, never returns tokens', async () => {
    const w = await seedWorkspace();
    // A workspace with no WhatsApp number is reported as not connected (a separate workspace: answers are cached per workspace).
    const fresh = await createTenantWithUser({ role: UserRole.ADMIN });
    const empty = (await get('whatsapp-status', token(app, { tenant: fresh.tenant, admin: fresh.user }), '').expect(200)).body;
    expect(empty).toMatchObject({ connected: false, numbers: [] });

    const num = (label: string, phoneNumberId: string) => testPrisma.whatsAppNumber.create({
      data: { tenantId: w.tenant.id, label, phoneNumberId, wabaId: `waba-${phoneNumberId}`, accessToken: 'secret-token-value', qualityRating: 'YELLOW', messagingLimitTier: 'TIER_250' },
    });
    await num('Main line', 'pn-good');
    await num('Old line', 'pn-bad');
    // Another workspace's number must never appear.
    const other = await seedWorkspace({ name: 'Other' });
    await testPrisma.whatsAppNumber.create({ data: { tenantId: other.tenant.id, label: 'Their line', phoneNumberId: 'pn-good', wabaId: 'w2', accessToken: 'x' } });

    const { body } = await get('whatsapp-status', token(app, w), 'refresh=true').expect(200);
    expect(body.connected).toBe(true);
    expect(body.numbers).toHaveLength(2);
    const good = body.numbers.find((n: { label: string }) => n.label === 'Main line');
    expect(good.live).toMatchObject({ quality: 'GREEN', messagingLimit: 'TIER_1K', verification: 'VERIFIED', numberStatus: 'CONNECTED' });
    expect(good.error).toBeNull();
    const bad = body.numbers.find((n: { label: string }) => n.label === 'Old line');
    expect(bad.live).toBeNull();
    expect(bad.error.kind).toBe('TOKEN_INVALID');
    expect(bad.lastKnown).toMatchObject({ quality: 'YELLOW', messagingLimit: 'TIER_250' });
    expect(JSON.stringify(body)).not.toContain('secret-token-value');
    expect(JSON.stringify(body)).not.toContain('Their line');
  });

  describe('reply deadline setting', () => {
    const patch = (tkn: string, body: unknown) =>
      request(app.getHttpServer()).patch('/manage/settings/reply-deadline').set('Authorization', `Bearer ${tkn}`).send(body as object);

    it('lets an admin change it, re-times waiting requests, and applies it to new requests', async () => {
      const w = await seedWorkspace();
      const waiting = await testPrisma.conversation.create({
        data: { tenantId: w.tenant.id, contactId: (await testPrisma.contact.findFirstOrThrow({ where: { tenantId: w.tenant.id } })).id, status: 'REQUESTED', requestedAt: at('2026-03-20T10:00:00Z'), slaDeadline: at('2026-03-20T10:15:00Z') },
      });
      const res = await patch(token(app, w), { minutes: 45 }).expect(200);
      expect(res.body.replyDeadlineMinutes).toBe(45);
      const retimed = await testPrisma.conversation.findUniqueOrThrow({ where: { id: waiting.id } });
      expect(retimed.slaDeadline?.toISOString()).toBe('2026-03-20T10:45:00.000Z');
      // A request already flagged as breached keeps its flag and deadline.
      const flagged = await testPrisma.conversation.findUniqueOrThrow({ where: { id: w.conv3.id } });
      expect(flagged.slaBreached).toBe(true);
      expect(flagged.slaDeadline?.toISOString()).toBe('2026-03-12T09:30:00.000Z');
      expect((await get('requests', token(app, w)).expect(200)).body.deadlineMinutes).toBe(45);

      // A new request made through the service now gets the new deadline.
      const open = await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: w.tenant.id, status: 'OPEN' } });
      const asked = await app.get(ConversationsService).request(w.tenant.id, open.id);
      const minutes = ((asked.slaDeadline as Date).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(44);
      expect(minutes).toBeLessThanOrEqual(45);
    });

    it('turns the deadline off with null, and new requests then have no deadline', async () => {
      const w = await seedWorkspace();
      await patch(token(app, w), { minutes: null }).expect(200);
      expect((await get('requests', token(app, w)).expect(200)).body.deadlineMinutes).toBeNull();
      const open = await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: w.tenant.id, status: 'OPEN' } });
      const asked = await app.get(ConversationsService).request(w.tenant.id, open.id);
      expect(asked.slaDeadline).toBeNull();
    });

    it('rejects values outside 1 to 1440 minutes, fractions and text', async () => {
      const w = await seedWorkspace();
      for (const minutes of [0, -5, 1441, 1.5, 'soon', undefined]) await patch(token(app, w), { minutes }).expect(400);
      await patch(token(app, w), { minutes: 1 }).expect(200);
      await patch(token(app, w), { minutes: 1440 }).expect(200);
    });

    it('is admin only and only changes the caller\'s workspace', async () => {
      const a = await seedWorkspace({ name: 'A' });
      const b = await seedWorkspace({ name: 'B' });
      const agent = signTestToken(app, { sub: a.ama.id, email: a.ama.email, tenantId: a.tenant.id, role: UserRole.AGENT });
      await patch(agent, { minutes: 5 }).expect(403);
      await patch(token(app, a), { minutes: 5, tenantId: b.tenant.id }).expect(400); // unknown field is rejected
      await patch(token(app, a), { minutes: 5 }).expect(200);
      expect((await get('requests', token(app, b)).expect(200)).body.deadlineMinutes).toBe(15);
    });
  });

  describe('security', () => {
    const paths = ['summary', 'trend', 'attention', 'requests', 'business', 'whatsapp-status'];

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
      const requests = (await get('requests', token(app, a)).expect(200)).body;
      expect(JSON.stringify(requests)).not.toContain(b.conv3.id);
      expect(requests.requesting).toBe(1); // A's own request only, not B's
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
