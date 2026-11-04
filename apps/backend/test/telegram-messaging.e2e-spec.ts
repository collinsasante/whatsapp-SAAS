import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestingApp } from './utils/test-app';
import { RealtimeService } from '../src/realtime/realtime.service';
import { StorageService } from '../src/media/storage.service';
import { MessagesService } from '../src/messages/messages.service';
import { CredentialsEncryptionService } from '../src/common/crypto/credentials-encryption.service';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * Telegram through the real webhook route and the real send path on a scratch database. Telegram itself is never called:
 * `fetch` is replaced by a fake Bot API, so this proves OUR behaviour (verification, tenant scoping, de-duplication,
 * storing, sending, failure mapping) and says nothing about a real bot or a real Telegram account.
 */
describe('Telegram messaging (e2e, mocked Bot API)', () => {
  let app: INestApplication;
  let fetchSpy: jest.SpyInstance;
  let calls: Array<{ method: string; body: unknown }>;
  let respond: (method: string, body: unknown) => unknown;
  const TOKEN = '123456:SECRET-BOT-TOKEN-VALUE';

  beforeAll(async () => { app = await createTestingApp(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => {
    await resetTestDatabase();
    calls = [];
    respond = (method) => (method === 'sendMessage' ? { ok: true, result: { message_id: 901 } } : { ok: true, result: true });
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      const method = url.split('/').pop() ?? '';
      if (url.includes('/file/bot')) return new Response(Buffer.from('PHOTO-BYTES'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      const body = init?.body instanceof FormData ? Object.fromEntries((init.body as FormData).entries()) : init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, body });
      return new Response(JSON.stringify(respond(method, body)), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    jest.spyOn(app.get(RealtimeService), 'emitNewMessage').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  async function bot(botId = '555', secret = `secret-${botId}`) {
    const { tenant, user } = await createTenantWithUser();
    const enc = app.get(CredentialsEncryptionService);
    const channel = await testPrisma.channel.create({
      data: { tenantId: tenant.id, type: 'TELEGRAM', name: `@bot${botId}`, externalId: botId, credentials: { botToken: enc.encrypt(TOKEN), webhookSecret: enc.encrypt(secret), externalId: botId } },
    });
    return { tenant, user, channel, secret };
  }
  const hook = (channelId: string, secret: string | undefined, update: object) => {
    const r = request(app.getHttpServer()).post(`/webhook/telegram/${channelId}`).set('Content-Type', 'application/json');
    return (secret ? r.set('x-telegram-bot-api-secret-token', secret) : r).send(update);
  };
  const text = (id: number, t: string, chat = 42) => ({ update_id: id, message: { message_id: id, date: 1_800_000_000, chat: { id: chat, type: 'private' }, from: { id: chat, is_bot: false, first_name: 'Ama', last_name: 'Mensah' }, text: t } });

  it('rejects a missing or wrong secret and an unknown channel, storing nothing', async () => {
    const { channel, tenant } = await bot();
    await hook(channel.id, undefined, text(1, 'hi')).expect(403);
    await hook(channel.id, 'not-the-secret', text(1, 'hi')).expect(403);
    await hook('00000000-0000-0000-0000-000000000000', 'x', text(1, 'hi')).expect(404);
    expect(await testPrisma.message.count({ where: { tenantId: tenant.id } })).toBe(0);
  });

  it('stores a text message once with the sender named, even when Telegram delivers it twice', async () => {
    const { channel, tenant } = await bot();
    await hook(channel.id, 'secret-555', text(10, 'Do you deliver?')).expect(200);
    await hook(channel.id, 'secret-555', text(10, 'Do you deliver?')).expect(200);
    const rows = await testPrisma.message.findMany({ where: { tenantId: tenant.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'INBOUND', type: 'TEXT', content: 'Do you deliver?', whatsappMessageId: 'tg:555:42:10', channelId: channel.id });
    const contact = await testPrisma.contact.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(contact).toMatchObject({ externalIdType: 'TELEGRAM_CHAT_ID', externalId: '42', name: 'Ama Mensah' });
    expect((await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: tenant.id } })).unreadCount).toBe(1);
  });

  it("does not let one workspace's secret open another workspace's channel, and keeps each message in its own workspace", async () => {
    const a = await bot('111', 'secret-a'); const b = await bot('222', 'secret-b');
    await hook(a.channel.id, 'secret-b', text(1, 'cross')).expect(403);
    await hook(a.channel.id, 'secret-a', text(2, 'for A')).expect(200);
    await hook(b.channel.id, 'secret-b', text(2, 'for B')).expect(200);
    expect((await testPrisma.message.findMany({ where: { tenantId: a.tenant.id } })).map((m) => m.content)).toEqual(['for A']);
    expect((await testPrisma.message.findMany({ where: { tenantId: b.tenant.id } })).map((m) => m.content)).toEqual(['for B']);
  });

  it('downloads a photo with the bot token, stores it, and never persists or returns the token', async () => {
    const { channel, tenant } = await bot();
    const upload = jest.spyOn(app.get(StorageService), 'uploadRaw').mockResolvedValue({ fileUrl: 'https://files.test/p.jpg' } as never);
    respond = (m) => (m === 'getFile' ? { ok: true, result: { file_id: 'F1', file_path: 'photos/p.jpg' } } : { ok: true, result: true });
    const update = { update_id: 5, message: { message_id: 5, chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false, first_name: 'Ama' }, caption: 'my order', photo: [{ file_id: 'S', file_size: 10 }, { file_id: 'F1', file_size: 99 }] } };
    const res = await hook(channel.id, 'secret-555', update).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-BOT-TOKEN');
    expect(upload).toHaveBeenCalledWith(Buffer.from('PHOTO-BYTES'), 'image/jpeg', tenant.id, expect.stringMatching(/^telegram-image\./));
    const m = await testPrisma.message.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(m).toMatchObject({ type: 'IMAGE', mediaUrl: 'https://files.test/p.jpg', mediaType: 'image/jpeg', content: 'my order' });
    expect(JSON.stringify(m)).not.toContain('SECRET-BOT-TOKEN');
  });

  it('keeps the message and labels the file when the download fails', async () => {
    const { channel, tenant } = await bot();
    respond = (m) => (m === 'getFile' ? { ok: false, error_code: 400, description: 'file is too big' } : { ok: true, result: true });
    await hook(channel.id, 'secret-555', { update_id: 6, message: { message_id: 6, chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false, first_name: 'Ama' }, document: { file_id: 'D', file_name: 'a.pdf' } } }).expect(200);
    const m = await testPrisma.message.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(m.mediaUrl).toBeNull();
    expect(m.content).toMatch(/could not be downloaded/);
  });

  it('ignores groups, bots, edits and a disconnected channel with a 200 so Telegram stops retrying', async () => {
    const { channel, tenant } = await bot();
    await hook(channel.id, 'secret-555', { update_id: 7, message: { message_id: 7, chat: { id: -100, type: 'group' }, from: { id: 1, is_bot: false }, text: 'g' } }).expect(200);
    await hook(channel.id, 'secret-555', { update_id: 8, message: { message_id: 8, chat: { id: 42, type: 'private' }, from: { id: 9, is_bot: true }, text: 'b' } }).expect(200);
    await hook(channel.id, 'secret-555', { update_id: 9, edited_message: { message_id: 3, chat: { id: 42, type: 'private' }, text: 'e' } }).expect(200);
    await testPrisma.channel.update({ where: { id: channel.id }, data: { isActive: false } });
    await hook(channel.id, 'secret-555', text(11, 'after disconnect')).expect(200);
    expect(await testPrisma.message.count({ where: { tenantId: tenant.id } })).toBe(0);
  });

  describe('sending', () => {
    async function conversationWithCustomer() {
      const ctx = await bot();
      await hook(ctx.channel.id, ctx.secret, text(20, 'hello')).expect(200);
      const conversation = await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: ctx.tenant.id } });
      return { ...ctx, conversation };
    }

    it('sends a reply through the bot to the right chat and stores Telegram\'s message id', async () => {
      const { tenant, user, conversation } = await conversationWithCustomer();
      const sent = await app.get(MessagesService).sendMessage(tenant.id, conversation.id, user.id, { type: 'TEXT', content: 'Yes, today' } as never);
      const call = calls.find((c) => c.method === 'sendMessage')!;
      expect(call.body).toMatchObject({ chat_id: '42', text: 'Yes, today' });
      expect(await testPrisma.message.findUniqueOrThrow({ where: { id: (sent as { id: string }).id } })).toMatchObject({ direction: 'OUTBOUND', whatsappMessageId: 'tg:555:42:901' });
      expect(fetchSpy.mock.calls.some(([u]) => String(u).includes(`/bot${TOKEN}/sendMessage`))).toBe(true);
    });

    const sendFailing = async (ctx: { tenant: { id: string }; user: { id: string }; conversation: { id: string } }, content: string) =>
      (await app.get(MessagesService).sendMessage(ctx.tenant.id, ctx.conversation.id, ctx.user.id, { type: 'TEXT', content } as never)) as { status: string; failureReason: string | null; content: string | null };

    // A failed send is kept in the conversation as FAILED with a reason the agent can act on (the same delivery-error state as the other channels).
    it('marks text over Telegram\'s limit as failed without calling Telegram', async () => {
      const m = await sendFailing(await conversationWithCustomer(), 'x'.repeat(4097));
      expect(m).toMatchObject({ status: 'FAILED' });
      expect(m.failureReason).toMatch(/4096/);
      expect(calls.some((c) => c.method === 'sendMessage')).toBe(false);
    });

    it('explains a blocked bot and does not leak the token', async () => {
      const ctx = await conversationWithCustomer();
      respond = (m) => (m === 'sendMessage' ? { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } : { ok: true, result: true });
      const m = await sendFailing(ctx, 'hi');
      expect(m.status).toBe('FAILED');
      expect(m.failureReason).toMatch(/blocked the bot/);
      expect(JSON.stringify(m)).not.toContain('SECRET-BOT-TOKEN');
    });

    it('flags the channel when Telegram rejects the token, so the team is told to reconnect', async () => {
      const ctx = await conversationWithCustomer();
      respond = (m) => (m === 'sendMessage' ? { ok: false, error_code: 401, description: 'Unauthorized' } : { ok: true, result: true });
      const m = await sendFailing(ctx, 'hi');
      expect(m.status).toBe('FAILED');
      expect(m.failureReason).toMatch(/Reconnect/i);
      expect((await testPrisma.channel.findUniqueOrThrow({ where: { id: ctx.channel.id } })).metadata).toMatchObject({ telegram: { status: 'CREDENTIALS_INVALID' } });
    });

    it('reports an unreachable Telegram as a failed, retryable send without leaking the token', async () => {
      const ctx = await conversationWithCustomer();
      fetchSpy.mockImplementation((async () => { throw new TypeError('fetch failed: https://api.telegram.org/bot123456:SECRET-BOT-TOKEN-VALUE/sendMessage'); }) as never);
      const m = await sendFailing(ctx, 'hi');
      expect(m.status).toBe('FAILED');
      expect(m.failureReason).toMatch(/could not be reached/);
      expect(JSON.stringify(m)).not.toContain('SECRET-BOT-TOKEN');
    });
  });
});
