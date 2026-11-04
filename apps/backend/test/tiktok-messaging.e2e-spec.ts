import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { RealtimeService } from '../src/realtime/realtime.service';
import { StorageService } from '../src/media/storage.service';
import { MessagesService } from '../src/messages/messages.service';
import { FeatureFlagsService } from '../src/feature-flags/feature-flags.service';
import { CredentialsEncryptionService } from '../src/common/crypto/credentials-encryption.service';
import { TikTokMessagingService } from '../src/tiktok-messaging/tiktok-messaging.service';
import { signOAuthState } from '../src/channels/oauth-state.util';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * TikTok Business Messaging through the real routes, the real send path and a real database, with TikTok replaced by a fake. The wire contract (paths,
 * payload fields, signature scheme) is the ADAPTER'S ASSUMPTION (see tiktok-messaging.contract.ts), so these tests prove our behaviour -- gating, signature
 * checks, tenant isolation, de-duplication, windows, failure handling, token rotation -- and nothing about the real TikTok API or an approved app.
 */
describe('TikTok messaging (e2e, mocked TikTok)', () => {
  let app: INestApplication;
  let tiktok: Array<{ path: string; method: string; headers: Record<string, string>; body: unknown }>;
  let reply: (path: string, body: unknown) => unknown | Promise<unknown>;
  const SECRET = 'business-app-secret';
  const BIZ = 'biz-100';
  const ACCESS = 'ACCESS-TOKEN-ABCDEFGHIJ-1';
  const ok = (data: object = {}) => ({ code: 0, message: 'OK', data, request_id: 'r1' });

  beforeAll(async () => {
    process.env['TIKTOK_BUSINESS_APP_ID'] = 'app-1';
    process.env['TIKTOK_BUSINESS_APP_SECRET'] = SECRET;
    process.env['TIKTOK_MESSAGING_CONTRACT_CONFIRMED'] = 'true';
    process.env['PUBLIC_URL'] = 'https://staging.example.test:8443';
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64'); // so the stored tokens really are encrypted
    app = await createTestingApp({ validation: true });
  });
  afterAll(async () => {
    await app.close(); await disconnectTestDatabase();
    for (const k of ['TIKTOK_BUSINESS_APP_ID', 'TIKTOK_BUSINESS_APP_SECRET', 'TIKTOK_MESSAGING_CONTRACT_CONFIRMED', 'PUBLIC_URL', 'CREDENTIALS_ENCRYPTION_KEY']) delete process.env[k];
  });
  beforeEach(async () => {
    await resetTestDatabase();
    process.env['TIKTOK_MESSAGING_CONTRACT_CONFIRMED'] = 'true';
    (app.get(FeatureFlagsService) as unknown as { cache: Map<string, unknown> }).cache.clear();
    tiktok = [];
    reply = (path) => path.endsWith('/message/send/') ? ok({ message_id: 'm-out-1' }) : path.endsWith('/image/upload/') ? ok({ media_id: 'media-1' }) : ok();
    jest.spyOn(global, 'fetch').mockImplementation((async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      const u = new URL(String(input));
      if (u.hostname !== 'business-api.tiktok.com') throw new Error(`unexpected network call ${u.hostname}`);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body instanceof FormData ? Object.fromEntries((init.body as FormData).entries()) : undefined;
      tiktok.push({ path: u.pathname, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: body ?? Object.fromEntries(u.searchParams.entries()) });
      if (u.pathname.endsWith('/image/download/')) return new Response(Buffer.from('IMG'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      const out = await reply(u.pathname, body);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    jest.spyOn(app.get(RealtimeService), 'emitNewMessage').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  async function workspace(opts: { biz?: string; flag?: boolean; expiresInMs?: number; active?: boolean } = {}) {
    const { tenant, user } = await createTenantWithUser();
    const biz = opts.biz ?? BIZ;
    const enc = app.get(CredentialsEncryptionService);
    const channel = await testPrisma.channel.create({
      data: {
        tenantId: tenant.id, type: 'TIKTOK', name: `TikTok messages ${tenant.id.slice(0, 4)}`, externalId: `biz:${biz}`, isActive: opts.active ?? true,
        credentials: { kind: 'business_messaging', businessId: biz, scope: 'tiktok_accounts', accessToken: enc.encrypt(ACCESS), refreshToken: enc.encrypt('REFRESH-1'), tokenExpiresAt: new Date(Date.now() + (opts.expiresInMs ?? 3_600_000)).toISOString(), externalId: `biz:${biz}` },
      },
    });
    if (opts.flag !== false) await testPrisma.featureFlag.upsert({ where: { key: 'tiktok_messaging' }, update: { enabled: true }, create: { key: 'tiktok_messaging', name: 'TikTok messaging', enabled: true } });
    const auth = (role: UserRole = UserRole.ADMIN) => `Bearer ${signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role })}`;
    return { tenant, user, channel, biz, auth };
  }

  const eventFor = (biz: string, o: { id: string; from: string; to: string; type?: string; text?: string; image?: string; ts?: number }) => ({
    event: 'im_send_msg', user_openid: biz, create_time: Math.floor((o.ts ?? Date.now()) / 1000),
    content: JSON.stringify({ message_id: o.id, conversation_id: `conv-${o.from === biz ? o.to : o.from}`, from_user: { id: o.from }, to_user: { id: o.to }, message_type: o.type ?? 'text', ...(o.text !== undefined && { text: { body: o.text } }), ...(o.image && { image: { media_id: o.image } }), timestamp: Math.floor((o.ts ?? Date.now()) / 1000) }),
  });
  const sign = (raw: string, t = Math.floor(Date.now() / 1000), secret = SECRET) => `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
  const post = (payload: object, header?: string | null) => {
    const raw = JSON.stringify(payload);
    const r = request(app.getHttpServer()).post('/webhook/tiktok-messaging').set('Content-Type', 'application/json');
    return (header === null ? r : r.set('tiktok-signature', header ?? sign(raw))).send(raw);
  };
  const inbound = (w: { biz: string }, id: string, text: string, from = 'user-1') => post(eventFor(w.biz, { id, from, to: w.biz, text }));

  describe('gating', () => {
    it('does nothing until the contract is confirmed by an operator, and says what is missing', async () => {
      const w = await workspace();
      process.env['TIKTOK_MESSAGING_CONTRACT_CONFIRMED'] = 'false';
      await inbound(w, 'm1', 'hi').expect(403);
      expect(await testPrisma.message.count()).toBe(0);
      const st = (await request(app.getHttpServer()).get('/tiktok/messaging/status').set('Authorization', w.auth()).expect(200)).body;
      expect(st.unmet.join(' ')).toMatch(/contract has not been confirmed/);
      expect(st.requirements.join(' ')).toMatch(/Business Messaging API access approved by TikTok/);
      expect(st.unconfirmedContract.map((i: { key: string }) => i.key)).toEqual(expect.arrayContaining(['sendPath', 'signatureAlgorithm']));
      await request(app.getHttpServer()).get('/tiktok/messaging/authorize-url').set('Authorization', w.auth()).expect(403);
      expect(tiktok).toHaveLength(0);
    });

    it('is off for a workspace without the feature flag', async () => {
      const w = await workspace({ flag: false });
      await inbound(w, 'm1', 'hi').expect(200).expect((r) => expect(r.body.status).toBe('ignored'));
      expect(await testPrisma.message.count()).toBe(0);
      const st = (await request(app.getHttpServer()).get('/tiktok/messaging/status').set('Authorization', w.auth()).expect(200)).body;
      expect(st.unmet.join(' ')).toMatch(/feature flag is off/);
    });

    it('reports every gate that is missing, including app credentials', async () => {
      const w = await workspace({ flag: false });
      delete process.env['TIKTOK_BUSINESS_APP_ID'];
      const st = (await request(app.getHttpServer()).get('/tiktok/messaging/status').set('Authorization', w.auth()).expect(200)).body;
      process.env['TIKTOK_BUSINESS_APP_ID'] = 'app-1';
      expect(st.unmet).toHaveLength(2);
    });
  });

  describe('webhook security and routing', () => {
    it('rejects a missing, wrong, stale or tampered signature and stores nothing', async () => {
      const w = await workspace();
      const payload = eventFor(w.biz, { id: 'm1', from: 'user-1', to: w.biz, text: 'hi' });
      const raw = JSON.stringify(payload);
      await post(payload, null).expect(403);
      await post(payload, 'garbage').expect(403);
      await post(payload, sign(raw, Math.floor(Date.now() / 1000), 'wrong-secret')).expect(403);
      await post(payload, sign(raw, Math.floor(Date.now() / 1000) - 60)).expect(403);                       // replay of an old delivery
      await post({ ...payload, content: payload.content.replace('hi', 'EVIL') }, sign(raw)).expect(403);    // body changed after signing
      expect(await testPrisma.message.count()).toBe(0);
    });

    it('stores an inbound message once with a readable contact, even when delivered twice', async () => {
      const w = await workspace();
      await inbound(w, 'm1', 'Do you deliver?').expect(200);
      await inbound(w, 'm1', 'Do you deliver?').expect(200).expect((r) => expect(r.body.status).toBe('duplicate'));
      const rows = await testPrisma.message.findMany({ where: { tenantId: w.tenant.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ direction: 'INBOUND', type: 'TEXT', content: 'Do you deliver?', whatsappMessageId: `tt:${w.biz}:m1`, channelId: w.channel.id });
      expect(await testPrisma.contact.findFirstOrThrow({ where: { tenantId: w.tenant.id } })).toMatchObject({ externalIdType: 'TIKTOK_USER_ID', externalId: 'user-1', name: 'TikTok user er-1' });
      expect((await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: w.tenant.id } })).unreadCount).toBe(1);
    });

    it('takes the workspace from its own record of the account, never from the payload', async () => {
      const a = await workspace({ biz: 'biz-A' }); const b = await workspace({ biz: 'biz-B' });
      await inbound(a, 'm1', 'for A').expect(200);
      await inbound(b, 'm1', 'for B').expect(200);                               // same provider message id in another account is a different message
      await inbound({ biz: 'biz-unknown' }, 'm9', 'nobody').expect(200).expect((r) => expect(r.body.status).toBe('ignored'));
      expect((await testPrisma.message.findMany({ where: { tenantId: a.tenant.id } })).map((m) => m.content)).toEqual(['for A']);
      expect((await testPrisma.message.findMany({ where: { tenantId: b.tenant.id } })).map((m) => m.content)).toEqual(['for B']);
    });

    it('drops events for an account connected to two workspaces and for a disconnected channel', async () => {
      const a = await workspace({ biz: 'biz-dup' }); const b = await workspace({ biz: 'biz-dup' });
      await inbound(a, 'm1', 'who gets this').expect(200).expect((r) => expect(r.body.status).toBe('ignored'));
      await testPrisma.channel.update({ where: { id: b.channel.id }, data: { isActive: false } });
      await inbound(a, 'm1', 'now it is unambiguous').expect(200).expect((r) => expect(r.body.status).toBe('stored'));
      await testPrisma.channel.update({ where: { id: a.channel.id }, data: { isActive: false } });
      await inbound(a, 'm2', 'after disconnect').expect(200).expect((r) => expect(r.body.status).toBe('ignored'));
      expect(await testPrisma.message.count()).toBe(1);
    });

    it('downloads an inbound image with the stored token, stores it, and labels what it cannot show', async () => {
      const w = await workspace();
      const upload = jest.spyOn(app.get(StorageService), 'uploadRaw').mockResolvedValue({ fileUrl: 'https://files.test/i.jpg' } as never);
      await post(eventFor(w.biz, { id: 'img1', from: 'user-1', to: w.biz, type: 'image', image: 'media-9' })).expect(200);
      expect(upload).toHaveBeenCalledWith(Buffer.from('IMG'), 'image/jpeg', w.tenant.id, expect.stringMatching(/^tiktok-image\./));
      expect(tiktok.find((c) => c.path.endsWith('/image/download/'))!.headers['Access-Token']).toBe(ACCESS);
      await post(eventFor(w.biz, { id: 'st1', from: 'user-1', to: w.biz, type: 'sticker' })).expect(200);
      await post(eventFor(w.biz, { id: 'x1', from: 'user-1', to: w.biz, type: 'video' })).expect(200);
      const rows = await testPrisma.message.findMany({ where: { tenantId: w.tenant.id }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => [r.type, r.mediaUrl, r.content])).toEqual([['IMAGE', 'https://files.test/i.jpg', null], ['TEXT', null, '[Sticker]'], ['TEXT', null, expect.stringContaining("can't display")]]);
    });

    it('acknowledges read receipts and malformed bodies without storing anything', async () => {
      const w = await workspace();
      await post({ event: 'im_mark_read_msg', user_openid: w.biz, content: '{}' }).expect(200);
      await post({ event: 'im_send_msg', user_openid: w.biz, content: 'not json' }).expect(200);
      await post({ nonsense: true }).expect(200);
      expect(await testPrisma.message.count()).toBe(0);
    });
  });

  describe('sending', () => {
    async function conversation(w: Awaited<ReturnType<typeof workspace>>, ageMs = 0) {
      await inbound(w, `m-${ageMs}`, 'hello').expect(200);
      const msg = await testPrisma.message.findFirstOrThrow({ where: { tenantId: w.tenant.id } });
      if (ageMs) await testPrisma.message.update({ where: { id: msg.id }, data: { createdAt: new Date(Date.now() - ageMs) } });
      return testPrisma.conversation.findFirstOrThrow({ where: { tenantId: w.tenant.id } });
    }
    const send = (w: { tenant: { id: string }; user: { id: string } }, convId: string, dto: object) =>
      app.get(MessagesService).sendMessage(w.tenant.id, convId, w.user.id, dto as never) as Promise<{ id: string; status: string; failureReason: string | null; whatsappMessageId: string | null }>;

    it('sends text through the business account to the right user and stores TikTok\'s message id', async () => {
      const w = await workspace(); const conv = await conversation(w);
      const m = await send(w, conv.id, { type: 'TEXT', content: 'Yes, today' });
      const call = tiktok.find((c) => c.path.endsWith('/message/send/'))!;
      expect(call.headers['Access-Token']).toBe(ACCESS);
      expect(call.body).toMatchObject({ business_id: w.biz, recipient_id: 'user-1', message_type: 'TEXT', text: { body: 'Yes, today' } });
      expect(await testPrisma.message.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ direction: 'OUTBOUND', whatsappMessageId: `tt:${w.biz}:m-out-1` });
    });

    it('does not store our own echo a second time, but does store a reply made in the TikTok app', async () => {
      const w = await workspace(); const conv = await conversation(w);
      await send(w, conv.id, { type: 'TEXT', content: 'from VerzChat' });
      await post(eventFor(w.biz, { id: 'm-out-1', from: w.biz, to: 'user-1', text: 'from VerzChat' })).expect(200);
      await post(eventFor(w.biz, { id: 'm-app-9', from: w.biz, to: 'user-1', text: 'typed in the TikTok app' })).expect(200);
      const out = await testPrisma.message.findMany({ where: { tenantId: w.tenant.id, direction: 'OUTBOUND' }, orderBy: { createdAt: 'asc' } });
      expect(out.map((m) => m.content).sort()).toEqual(['from VerzChat', 'typed in the TikTok app']);
      expect(out.find((m) => m.content === 'typed in the TikTok app')!.metadata).toMatchObject({ source: 'external' });
    });

    it('refuses to reply after the window closes and to send anything but text or one image', async () => {
      const w = await workspace(); const old = await conversation(w, 49 * 3_600_000);
      await expect(send(w, old.id, { type: 'TEXT', content: 'late' })).rejects.toThrow(/after the person messages you/);
      const fresh = await workspace({ biz: 'biz-2' }); const conv = await conversation(fresh);
      await expect(send(fresh, conv.id, { type: 'DOCUMENT', mediaUrl: 'x' })).rejects.toThrow(/text or one image/);
      await expect(send(fresh, conv.id, { type: 'LOCATION' })).rejects.toThrow(/text or one image/);
      expect(tiktok.some((c) => c.path.endsWith('/message/send/'))).toBe(false);
    });

    it('fails a text over the limit without calling TikTok', async () => {
      const w = await workspace(); const conv = await conversation(w);
      const m = await send(w, conv.id, { type: 'TEXT', content: 'x'.repeat(6001) });
      expect(m).toMatchObject({ status: 'FAILED' });
      expect(m.failureReason).toMatch(/6000/);
      expect(tiktok.some((c) => c.path.endsWith('/message/send/'))).toBe(false);
    });

    it('retries a rate limit and then succeeds; never retries a lost answer', async () => {
      const w = await workspace(); const conv = await conversation(w);
      let n = 0;
      reply = (path) => path.endsWith('/message/send/') ? (++n === 1 ? new Response(JSON.stringify({ code: 51021, message: 'rate limit' }), { status: 429 }) : ok({ message_id: 'm-out-2' })) : ok();
      expect((await send(w, conv.id, { type: 'TEXT', content: 'a' })).status).not.toBe('FAILED');
      expect(tiktok.filter((c) => c.path.endsWith('/message/send/'))).toHaveLength(2);

      tiktok = [];
      (global.fetch as jest.Mock).mockClear();
      (global.fetch as jest.Mock).mockImplementation(async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); });
      const lost = await send(w, conv.id, { type: 'TEXT', content: 'b' });
      expect(lost.status).toBe('FAILED');
      expect(lost.failureReason).toMatch(/did not confirm this message/);
      expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
    });

    it('turns a rejected authorisation into a reconnect prompt and flags the channel', async () => {
      const w = await workspace(); const conv = await conversation(w);
      reply = (path) => path.endsWith('/message/send/') ? new Response(JSON.stringify({ code: 40105, message: 'Access token is invalid' }), { status: 401 }) : ok();
      const m = await send(w, conv.id, { type: 'TEXT', content: 'hi' });
      expect(m.status).toBe('FAILED');
      expect(m.failureReason).toMatch(/Reconnect the TikTok account/);
      expect((await testPrisma.channel.findUniqueOrThrow({ where: { id: w.channel.id } })).metadata).toMatchObject({ tiktokMessagingAuth: { status: 'REAUTH_REQUIRED' } });
      tiktok = [];
      const again = await send(w, conv.id, { type: 'TEXT', content: 'hi again' });
      expect(again.failureReason).toMatch(/reconnected/);
      expect(tiktok).toHaveLength(0);
    });

    it('sends one image as upload then send, and the caption as a separate text', async () => {
      const w = await workspace(); const conv = await conversation(w);
      jest.spyOn(app.get(MessagesService) as unknown as { loadMediaBuffer: () => unknown }, 'loadMediaBuffer').mockResolvedValue({ buffer: Buffer.alloc(100, 1), mimeType: 'image/png' } as never);
      const m = await send(w, conv.id, { type: 'IMAGE', mediaUrl: 'https://files.test/p.png', mediaCaption: 'our menu' });
      expect(m.status).not.toBe('FAILED');
      const sends = tiktok.filter((c) => c.path.endsWith('/message/send/')).map((c) => (c.body as { message_type: string }).message_type);
      expect(tiktok.some((c) => c.path.endsWith('/image/upload/'))).toBe(true);
      expect(sends).toEqual(['IMAGE', 'TEXT']);
    });

    it('refuses an image TikTok does not accept (type or size) without calling TikTok', async () => {
      const w = await workspace(); const conv = await conversation(w);
      const load = jest.spyOn(app.get(MessagesService) as unknown as { loadMediaBuffer: () => unknown }, 'loadMediaBuffer');
      load.mockResolvedValueOnce({ buffer: Buffer.alloc(10), mimeType: 'image/webp' } as never);
      expect((await send(w, conv.id, { type: 'IMAGE', mediaUrl: 'https://files.test/a.webp' })).failureReason).toMatch(/JPG or PNG/);
      load.mockResolvedValueOnce({ buffer: Buffer.alloc(4 * 1024 * 1024), mimeType: 'image/jpeg' } as never);
      expect((await send(w, conv.id, { type: 'IMAGE', mediaUrl: 'https://files.test/b.jpg' })).failureReason).toMatch(/under 3 MB/);
      expect(tiktok.some((c) => c.path.endsWith('/image/upload/'))).toBe(false);
    });
  });

  describe('tokens', () => {
    it('refreshes an expiring token pair, stores the rotated pair encrypted, and uses the new token', async () => {
      const w = await workspace({ expiresInMs: 60_000 }); const enc = app.get(CredentialsEncryptionService);
      reply = (path) => path.endsWith('/refresh_token/') ? ok({ access_token: 'NEW-ACCESS-TOKEN-0000-2', refresh_token: 'NEW-REFRESH-2', expires_in: 86400, refresh_expires_in: 2592000 }) : path.endsWith('/message/send/') ? ok({ message_id: 'm-out-3' }) : ok();
      await inbound(w, 'm1', 'hello').expect(200);
      const conv = await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: w.tenant.id } });
      await app.get(MessagesService).sendMessage(w.tenant.id, conv.id, w.user.id, { type: 'TEXT', content: 'x' } as never);
      expect(tiktok.find((c) => c.path.endsWith('/message/send/'))!.headers['Access-Token']).toBe('NEW-ACCESS-TOKEN-0000-2');
      const creds = (await testPrisma.channel.findUniqueOrThrow({ where: { id: w.channel.id } })).credentials as Record<string, string>;
      expect(creds['accessToken']).toMatch(/^enc:v1:|^NEW/);
      expect(enc.decrypt(creds['refreshToken']!)).toBe('NEW-REFRESH-2');
      expect(creds['kind']).toBe('business_messaging');
    });

    it('marks the account for reconnection when the refresh token is rejected', async () => {
      const w = await workspace({ expiresInMs: -1000 });
      reply = (path) => path.endsWith('/refresh_token/') ? new Response(JSON.stringify({ code: 40104, message: 'refresh token expired' }), { status: 401 }) : ok();
      await post(eventFor(w.biz, { id: 'img', from: 'user-1', to: w.biz, type: 'image', image: 'm' })).expect(200);
      expect((await testPrisma.channel.findUniqueOrThrow({ where: { id: w.channel.id } })).metadata).toMatchObject({ tiktokMessagingAuth: { status: 'REAUTH_REQUIRED' } });
    });
  });

  describe('connection', () => {
    const callback = (q: object) => request(app.getHttpServer()).get('/tiktok/messaging/callback').query(q).redirects(0);
    const stateFor = (w: { tenant: { id: string }; user: { id: string } }, provider = 'tiktok-messaging') => signOAuthState({ tenantId: w.tenant.id, provider, userId: w.user.id }, process.env['JWT_SECRET'] ?? 'changeme');

    it('connects an account from a signed callback: encrypted tokens, one workspace only', async () => {
      const a = await workspace({ biz: 'unused-a' }); await testPrisma.channel.deleteMany({ where: { tenantId: a.tenant.id } });
      reply = (path) => path.endsWith('/access_token/') ? ok({ access_token: 'ACCESS-NEW-0123456789', refresh_token: 'REFRESH-NEW-0123456789', expires_in: 86400, business_id: 'biz-777', scope: ['tiktok_accounts'] }) : ok();
      const res = await callback({ auth_code: 'code-1', state: stateFor(a) }).expect(302);
      expect(res.headers['location']).toMatch(/success=tiktok-messaging/);
      const ch = await testPrisma.channel.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
      expect(ch).toMatchObject({ type: 'TIKTOK', externalId: 'biz:biz-777', isActive: true });
      expect(JSON.stringify(ch.credentials)).not.toContain('ACCESS-NEW');
      expect(ch.credentials).toMatchObject({ kind: 'business_messaging', businessId: 'biz-777' });
      expect(tiktok[0]!.body).toMatchObject({ app_id: 'app-1', auth_code: 'code-1' });
      // The same TikTok account cannot also be attached to a second workspace.
      const b = await workspace({ biz: 'unused-b' }); await testPrisma.channel.deleteMany({ where: { tenantId: b.tenant.id } });
      const res2 = await callback({ auth_code: 'code-2', state: stateFor(b) }).expect(302);
      expect(res2.headers['location']).toMatch(/error=.*another%20workspace/);
      expect(await testPrisma.channel.count({ where: { tenantId: b.tenant.id } })).toBe(0);
    });

    it('rejects a missing, forged or wrong-provider state and never calls TikTok', async () => {
      const w = await workspace();
      for (const q of [{ auth_code: 'c' }, { auth_code: 'c', state: 'forged.state' }, { auth_code: 'c', state: stateFor(w, 'facebook') }, { state: stateFor(w) }]) {
        expect((await callback(q).expect(302)).headers['location']).toMatch(/error=auth_cancelled/);
      }
      expect(tiktok).toHaveLength(0);
    });

    it('only platform operators can register the webhook, and only for an HTTPS address', async () => {
      const w = await workspace();
      await request(app.getHttpServer()).post('/tiktok/messaging/webhook/register').set('Authorization', w.auth(UserRole.ADMIN)).expect(403);
      reply = (path) => path.endsWith('/webhook/list/') ? ok({ webhooks: [{ callback_url: 'https://staging.example.test:8443/api/v1/webhook/tiktok-messaging' }] }) : ok();
      const r = await app.get(TikTokMessagingService).registerWebhook();
      expect(r).toMatchObject({ registered: true, confirmedByTikTok: true });
      expect(tiktok.find((c) => c.path.endsWith('/webhook/update/'))!.body).toMatchObject({ event_type: 'DIRECT_MESSAGE', callback_url: 'https://staging.example.test:8443/api/v1/webhook/tiktok-messaging' });
    });
  });

  describe('history', () => {
    it('imports earlier messages silently, once, without unread counts or notifications', async () => {
      const w = await workspace();
      const old = (id: string, from: string, to: string, text: string, ts: number) => ({ message_id: id, from_user: { id: from }, to_user: { id: to }, message_type: 'text', text: { body: text }, timestamp: ts });
      reply = (path) => path.endsWith('/conversation/list/') ? ok({ conversations: [{ conversation_id: 'c1', user_id: 'user-5' }], has_more: false })
        : path.endsWith('/message/list/') ? ok({ messages: [old('h1', 'user-5', w.biz, 'older question', 1_700_000_000), old('h2', w.biz, 'user-5', 'older answer', 1_700_000_100)], has_more: false }) : ok();
      const first = await request(app.getHttpServer()).post(`/tiktok/messaging/channels/${w.channel.id}/import-history`).set('Authorization', w.auth()).expect(200);
      expect(first.body).toMatchObject({ conversations: 1, messagesImported: 2, messagesSkipped: 0 });
      const second = await request(app.getHttpServer()).post(`/tiktok/messaging/channels/${w.channel.id}/import-history`).set('Authorization', w.auth()).expect(200);
      expect(second.body).toMatchObject({ messagesImported: 0, messagesSkipped: 2 });
      const rows = await testPrisma.message.findMany({ where: { tenantId: w.tenant.id }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => [r.direction, r.content])).toEqual([['INBOUND', 'older question'], ['OUTBOUND', 'older answer']]);
      expect((await testPrisma.conversation.findFirstOrThrow({ where: { tenantId: w.tenant.id } })).unreadCount).toBe(0);
    });

    it('will not import into another workspace\'s channel', async () => {
      const a = await workspace({ biz: 'biz-A' }); const b = await workspace({ biz: 'biz-B' });
      await request(app.getHttpServer()).post(`/tiktok/messaging/channels/${a.channel.id}/import-history`).set('Authorization', b.auth()).expect(400);
      expect(tiktok.filter((c) => c.path.endsWith('/conversation/list/'))).toHaveLength(0);
    });
  });

  it('keeps messaging connections out of the posting feature', async () => {
    const w = await workspace();
    await testPrisma.featureFlag.upsert({ where: { key: 'tiktok_publishing' }, update: { enabled: true }, create: { key: 'tiktok_publishing', name: 'p', enabled: true } });
    const r = await request(app.getHttpServer()).post('/tiktok/publications').set('Authorization', w.auth()).send({ channelId: w.channel.id, mediaKey: `${w.tenant.id}/v.mp4`, caption: 'x' }).expect(400);
    expect(r.body.message).toMatch(/connection is for messaging/);
  });
});
