import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestingApp } from './utils/test-app';
import { RealtimeService } from '../src/realtime/realtime.service';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * The real webhook route end to end on a scratch database: signature check, routing by Page id, storing customer
 * messages and replies sent outside VerzChat, and the guarantees around them (once only, per workspace, no reopening).
 * Meta itself is never called.
 */
describe('Messenger webhook: sync of customer messages and replies sent outside VerzChat (e2e)', () => {
  let app: INestApplication;
  const SECRET = 'test-app-secret';
  const OWN_APP = '777000';
  let emitNew: jest.SpyInstance;

  beforeAll(async () => {
    process.env['FACEBOOK_APP_SECRET'] = SECRET;
    process.env['FACEBOOK_APP_ID'] = OWN_APP;
    app = await createTestingApp();
  });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); delete process.env['FACEBOOK_APP_SECRET']; delete process.env['FACEBOOK_APP_ID']; });
  beforeEach(async () => {
    await resetTestDatabase();
    emitNew = jest.spyOn(app.get(RealtimeService), 'emitNewMessage').mockImplementation(() => undefined);
  });
  afterEach(() => emitNew.mockRestore());

  async function workspace(pageId: string) {
    const { tenant } = await createTenantWithUser();
    const channel = await testPrisma.channel.create({ data: { tenantId: tenant.id, type: 'FACEBOOK_MESSENGER', name: `Page ${pageId}`, externalId: pageId } });
    return { tenant, channel };
  }

  const post = (payload: object, sign = true) => {
    const raw = JSON.stringify(payload);
    const sig = sign ? `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` : 'sha256=deadbeef';
    return request(app.getHttpServer()).post('/webhook/messenger').set('Content-Type', 'application/json').set('x-hub-signature-256', sig).send(raw);
  };
  const entry = (pageId: string, ...messaging: object[]) => ({ object: 'page', entry: [{ id: pageId, time: 1, messaging }] });
  const customerSays = (pageId: string, psid: string, mid: string, text: string, ts = Date.now()) =>
    ({ sender: { id: psid }, recipient: { id: pageId }, timestamp: ts, message: { mid, text } });
  const pageSays = (pageId: string, psid: string, mid: string, text: string, appId?: number | string, ts = Date.now()) =>
    ({ sender: { id: pageId }, recipient: { id: psid }, timestamp: ts, message: { mid, text, is_echo: true, ...(appId ? { app_id: appId } : {}) } });

  it('stores a customer message once, even when Meta delivers it twice', async () => {
    const { tenant } = await workspace('PAGE-A');
    const ev = customerSays('PAGE-A', 'PSID-1', 'mid.1', 'Hello, do you deliver?');
    await post(entry('PAGE-A', ev)).expect(200);
    await post(entry('PAGE-A', ev)).expect(200);
    const rows = await testPrisma.message.findMany({ where: { tenantId: tenant.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'INBOUND', content: 'Hello, do you deliver?', whatsappMessageId: 'mid.1' });
    const conv = await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(conv.unreadCount).toBe(1);
  });

  it('stores a reply typed in the Page inbox on another device, in the same conversation, without disturbing it', async () => {
    const { tenant } = await workspace('PAGE-A');
    await post(entry('PAGE-A', customerSays('PAGE-A', 'PSID-1', 'mid.1', 'Is it in stock?', 1_800_000_000_000))).expect(200);
    const before = await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: tenant.id } });

    await post(entry('PAGE-A', pageSays('PAGE-A', 'PSID-1', 'mid.reply', 'Yes, come by today', undefined, 1_800_000_060_000))).expect(200);

    const msgs = await testPrisma.message.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => [m.direction, m.content, m.status])).toEqual([['INBOUND', 'Is it in stock?', 'DELIVERED'], ['OUTBOUND', 'Yes, come by today', 'SENT']]);
    expect(msgs[1].conversationId).toBe(before.id);
    expect(msgs[1].senderId).toBeNull();
    expect(msgs[1].metadata).toMatchObject({ source: 'external' });
    const after = await testPrisma.conversation.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.lastMessageAt?.getTime()).toBe(1_800_000_060_000);
    expect({ status: after.status, assignedToId: after.assignedToId, unread: after.unreadCount }).toEqual({ status: before.status, assignedToId: before.assignedToId, unread: before.unreadCount });
    // The open inbox is told about it.
    expect(emitNew).toHaveBeenCalledWith(tenant.id, before.id, expect.objectContaining({ whatsappMessageId: 'mid.reply', direction: 'OUTBOUND' }));
  });

  it('stores that reply once when Meta repeats the delivery', async () => {
    const { tenant } = await workspace('PAGE-A');
    await post(entry('PAGE-A', customerSays('PAGE-A', 'PSID-1', 'mid.1', 'hi'))).expect(200);
    const echo = entry('PAGE-A', pageSays('PAGE-A', 'PSID-1', 'mid.reply', 'hello'));
    await post(echo).expect(200);
    await post(echo).expect(200);
    expect(await testPrisma.message.count({ where: { tenantId: tenant.id, direction: 'OUTBOUND' } })).toBe(1);
  });

  it('ignores the echo of a message VerzChat sent itself (AI or agent), so nothing is duplicated', async () => {
    const { tenant } = await workspace('PAGE-A');
    await post(entry('PAGE-A', customerSays('PAGE-A', 'PSID-1', 'mid.1', 'hi'))).expect(200);
    const conv = await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const contact = await testPrisma.contact.findFirstOrThrow({ where: { tenantId: tenant.id } });
    // What the send path stored a moment before Meta's echo arrives.
    await testPrisma.message.create({ data: { tenantId: tenant.id, conversationId: conv.id, contactId: contact.id, direction: 'OUTBOUND', status: 'QUEUED', content: 'AI reply' } });

    await post(entry('PAGE-A', pageSays('PAGE-A', 'PSID-1', 'mid.ai', 'AI reply', OWN_APP))).expect(200);

    const outbound = await testPrisma.message.findMany({ where: { tenantId: tenant.id, direction: 'OUTBOUND' } });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].whatsappMessageId).toBeNull(); // the send path will attach Meta's id; the echo did not touch it
  });

  it('handles a reply that arrives before the customer message it answers (out of order)', async () => {
    const { tenant } = await workspace('PAGE-A');
    await post(entry('PAGE-A', pageSays('PAGE-A', 'PSID-1', 'mid.reply', 'Welcome back!', undefined, 1_000))).expect(200);
    await post(entry('PAGE-A', customerSays('PAGE-A', 'PSID-1', 'mid.1', 'Thanks', 2_000))).expect(200);
    expect(await testPrisma.conversation.count({ where: { tenantId: tenant.id } })).toBe(1);
    const msgs = await testPrisma.message.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => m.direction)).toEqual(['OUTBOUND', 'INBOUND']);
  });

  it('does not reopen a resolved conversation or alert the team for a reply sent outside VerzChat', async () => {
    const { tenant } = await workspace('PAGE-A');
    await post(entry('PAGE-A', customerSays('PAGE-A', 'PSID-1', 'mid.1', 'hi'))).expect(200);
    await testPrisma.conversation.updateMany({ where: { tenantId: tenant.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    await post(entry('PAGE-A', pageSays('PAGE-A', 'PSID-1', 'mid.reply', 'Glad we could help'))).expect(200);
    const conv = await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(conv.status).toBe('RESOLVED');
    expect(await testPrisma.notification.count({ where: { tenantId: tenant.id, type: 'CONVERSATION_REQUESTED' as never } })).toBeLessThanOrEqual(1); // only the original request's
  });

  it('keeps workspaces apart: each Page\'s events land only in its own workspace', async () => {
    const a = await workspace('PAGE-A');
    const b = await workspace('PAGE-B');
    await post(entry('PAGE-A', customerSays('PAGE-A', 'PSID-1', 'mid.a', 'for A'))).expect(200);
    await post(entry('PAGE-B', customerSays('PAGE-B', 'PSID-1', 'mid.b', 'for B'), pageSays('PAGE-B', 'PSID-1', 'mid.b2', 'reply from B', undefined, Date.now() + 60_000))).expect(200);
    expect((await testPrisma.message.findMany({ where: { tenantId: a.tenant.id } })).map((m) => m.content)).toEqual(['for A']);
    expect((await testPrisma.message.findMany({ where: { tenantId: b.tenant.id }, orderBy: { createdAt: 'asc' } })).map((m) => m.content)).toEqual(['for B', 'reply from B']);
  });

  it('rejects an unsigned or wrongly signed delivery and stores nothing', async () => {
    const { tenant } = await workspace('PAGE-A');
    await post(entry('PAGE-A', customerSays('PAGE-A', 'PSID-1', 'mid.1', 'forged')), false).expect(400);
    expect(await testPrisma.message.count({ where: { tenantId: tenant.id } })).toBe(0);
  });

  it('acknowledges events for a Page nobody has connected, and malformed bodies, without storing anything', async () => {
    const { tenant } = await workspace('PAGE-A');
    await post(entry('PAGE-UNKNOWN', customerSays('PAGE-UNKNOWN', 'PSID-1', 'mid.x', 'hi'))).expect(200);
    await post({ object: 'page' }).expect(200);
    await post({ object: 'page', entry: [{ id: 'PAGE-A', messaging: [{ message: { mid: 'm' } }] }] }).expect(200); // malformed event: skipped, not retried forever
    expect(await testPrisma.message.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
});
