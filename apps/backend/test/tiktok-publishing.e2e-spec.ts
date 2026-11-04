import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { StorageService } from '../src/media/storage.service';
import { FeatureFlagsService } from '../src/feature-flags/feature-flags.service';
import { CredentialsEncryptionService } from '../src/common/crypto/credentials-encryption.service';
import { TikTokPublishingService } from '../src/tiktok-publishing/tiktok-publishing.service';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * TikTok publishing through the real routes, the real runner and a real database. TikTok itself is replaced by a fake Content Posting API (`fetch`),
 * so this proves OUR behaviour -- gating, roles, tenant isolation, idempotency, retries, uncertainty handling, token handling -- and says nothing about a
 * real TikTok account, a real app review or real publishing.
 */
describe('TikTok publishing (e2e, mocked TikTok API)', () => {
  let app: INestApplication;
  let tiktok: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }>;
  let initReply: () => Response | Promise<Response>;
  let statusReply: () => Response;
  let creatorReply: () => Response;
  let putStatus: number;
  const ACCESS = 'ACCESS-TOKEN-ABCDEFGHIJ-1';
  const video = Buffer.alloc(2048, 7);

  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const okInit = () => json({ data: { publish_id: 'v_pub_1', upload_url: 'https://upload.tiktok.test/u/1' }, error: { code: 'ok', message: '' } });

  beforeAll(async () => { app = await createTestingApp({ validation: true }); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => {
    await resetTestDatabase();
    (app.get(FeatureFlagsService) as unknown as { cache: Map<string, unknown> }).cache.clear();
    tiktok = []; initReply = okInit; putStatus = 201;
    creatorReply = () => json({ data: { privacy_level_options: ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS'], comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600 }, error: { code: 'ok' } });
    statusReply = () => json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['7300000000000000001'] }, error: { code: 'ok' } });
    jest.spyOn(global, 'fetch').mockImplementation((async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      const url = String(input);
      if (!url.includes('tiktok')) throw new Error(`unexpected network call ${url}`);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      tiktok.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body });
      if (url.endsWith('/creator_info/query/')) return creatorReply();
      if (url.endsWith('/video/init/')) return initReply();
      if (url.endsWith('/status/fetch/')) return statusReply();
      if (url.includes('upload.tiktok.test')) return new Response(null, { status: putStatus });
      return json({}, 404);
    }) as unknown as typeof fetch);
    jest.spyOn(app.get(StorageService), 'downloadBuffer').mockImplementation((async () => ({ buffer: video, mimeType: 'video/mp4' })) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  async function workspace(opts: { flag?: boolean; scope?: string; expiresInMs?: number } = {}) {
    const { tenant, user } = await createTenantWithUser();
    const enc = app.get(CredentialsEncryptionService);
    const channel = await testPrisma.channel.create({
      data: {
        tenantId: tenant.id, type: 'TIKTOK', name: 'creator', externalId: 'open-1',
        credentials: { accessToken: enc.encrypt(ACCESS), refreshToken: enc.encrypt('REFRESH-1'), openId: 'open-1', scope: opts.scope ?? 'user.info.basic,video.publish',
          tokenExpiresAt: new Date(Date.now() + (opts.expiresInMs ?? 3_600_000)).toISOString() },
      },
    });
    if (opts.flag !== false) await testPrisma.featureFlag.upsert({ where: { key: 'tiktok_publishing' }, update: { enabled: true }, create: { key: 'tiktok_publishing', name: 'TikTok publishing', enabled: true } });
    // The app re-reads each user's role from the database, so every role needs a real user.
    const others = new Map<UserRole, { id: string; email: string }>([[UserRole.ADMIN, user]]);
    for (const role of [UserRole.AGENT, UserRole.VIEWER]) {
      others.set(role, await testPrisma.user.create({ data: { tenantId: tenant.id, name: role, email: `${role}-${tenant.id}@example.com`, passwordHash: 'x', role, isActive: true } }));
    }
    const auth = (role: UserRole = UserRole.ADMIN) => { const u = others.get(role)!; return `Bearer ${signTestToken(app, { sub: u.id, email: u.email, tenantId: tenant.id, role })}`; };
    return { tenant, user, channel, auth, mediaKey: `${tenant.id}/clip.mp4` };
  }
  const create = (w: Awaited<ReturnType<typeof workspace>>, extra: object = {}, role?: UserRole) =>
    request(app.getHttpServer()).post('/tiktok/publications').set('Authorization', w.auth(role)).send({ channelId: w.channel.id, mediaKey: w.mediaKey, caption: 'Launch day #verz', ...extra });
  const run = () => app.get(TikTokPublishingService).runDueOnce();
  const rowOf = (id: string) => testPrisma.tikTokPublication.findUniqueOrThrow({ where: { id } });
  const initCalls = () => tiktok.filter((c) => c.url.endsWith('/video/init/'));

  it('stays off until the feature flag is enabled', async () => {
    const w = await workspace({ flag: false });
    await create(w).expect(403);
    expect(await testPrisma.tikTokPublication.count()).toBe(0);
    const cfg = await request(app.getHttpServer()).get('/tiktok/publications/config').set('Authorization', w.auth()).expect(200);
    expect(cfg.body).toMatchObject({ enabled: false, allowedPrivacyLevels: ['SELF_ONLY'] });
  });

  it('only admins can post; agents can look; viewers see nothing', async () => {
    const w = await workspace();
    await create(w, {}, UserRole.AGENT).expect(403);
    await create(w, {}, UserRole.VIEWER).expect(403);
    await request(app.getHttpServer()).get('/tiktok/publications').set('Authorization', w.auth(UserRole.AGENT)).expect(200);
    await request(app.getHttpServer()).get('/tiktok/publications').set('Authorization', w.auth(UserRole.VIEWER)).expect(403);
  });

  it('uploads and publishes: init with the decrypted token and "Only me", chunked PUT, then status to PUBLISHED, with an audit trail', async () => {
    const w = await workspace();
    const res = await create(w).expect(201);
    expect(res.body).toMatchObject({ status: 'QUEUED', privacyLevel: 'SELF_ONLY' });
    await run();
    const init = initCalls()[0]!;
    expect(init.headers['Authorization']).toBe(`Bearer ${ACCESS}`);
    expect(tiktok.findIndex((c) => c.url.endsWith('/creator_info/query/'))).toBeLessThan(tiktok.findIndex((c) => c.url.endsWith('/video/init/')));   // TikTok requires the query first
    expect(init.body).toMatchObject({
      post_info: { title: 'Launch day #verz', privacy_level: 'SELF_ONLY', brand_content_toggle: false, brand_organic_toggle: false, disable_comment: false, disable_duet: true, disable_stitch: false },
      source_info: { source: 'FILE_UPLOAD', video_size: 2048, chunk_size: 2048, total_chunk_count: 1 },
    });
    const put = tiktok.find((c) => c.method === 'PUT')!;
    expect(put.headers['Content-Range']).toBe('bytes 0-2047/2048');
    expect(await rowOf(res.body.id)).toMatchObject({ status: 'PROCESSING', publishId: 'v_pub_1', attempts: 1, leaseOwner: null });

    await testPrisma.tikTokPublication.update({ where: { id: res.body.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await run();
    expect(await rowOf(res.body.id)).toMatchObject({ status: 'PUBLISHED', tiktokPostId: '7300000000000000001', lastError: null });
    const audit = await testPrisma.auditLog.findMany({ where: { tenantId: w.tenant.id, resource: 'tiktok_publication' }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => (a.metadata as { action: string }).action)).toEqual(['TIKTOK_PUBLISH_REQUESTED', 'TIKTOK_PUBLISH_RESULT']);
    expect(JSON.stringify(audit)).not.toContain(ACCESS);
  });

  it('never creates two posts for one request: same idempotency key, and two runners at once', async () => {
    const w = await workspace();
    const a = await create(w, { idempotencyKey: 'click-1' }).expect(201);
    const b = await create(w, { idempotencyKey: 'click-1' }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await testPrisma.tikTokPublication.count()).toBe(1);
    // A second replica that listed the due post before the first replica claimed it: it holds a stale "QUEUED" snapshot and must lose the claim.
    const svc = app.get(TikTokPublishingService) as unknown as Record<string, unknown>;
    const snapshot = await testPrisma.tikTokPublication.findMany();
    const prisma = svc['prisma'] as { tikTokPublication: Record<string, unknown> };
    const stalePrisma = new Proxy(prisma, {
      get: (t, k) => k !== 'tikTokPublication' ? Reflect.get(t, k) : new Proxy(t.tikTokPublication, {
        get: (m, f) => f === 'findMany' ? async () => snapshot : Reflect.get(m, f),
      }),
    });
    const other = new (TikTokPublishingService as unknown as new (...a: unknown[]) => TikTokPublishingService)(
      stalePrisma, svc['config'], svc['audit'], svc['flags'], svc['storage'], svc['encryption']);
    await run();
    await other.runDueOnce();
    expect(initCalls()).toHaveLength(1);
  });

  it('keeps each workspace to its own posts, channels and media', async () => {
    const a = await workspace(); const b = await workspace();
    const post = await create(a).expect(201);
    await request(app.getHttpServer()).get(`/tiktok/publications/${post.body.id}`).set('Authorization', b.auth()).expect(404);
    await request(app.getHttpServer()).post(`/tiktok/publications/${post.body.id}/cancel`).set('Authorization', b.auth()).expect(404);
    await request(app.getHttpServer()).post(`/tiktok/publications/${post.body.id}/retry`).set('Authorization', b.auth()).send({}).expect(404);
    expect((await request(app.getHttpServer()).get('/tiktok/publications').set('Authorization', b.auth()).expect(200)).body).toEqual([]);
    await create(b, { channelId: a.channel.id }).expect(400);          // someone else's TikTok account
    await create(b, { mediaKey: a.mediaKey }).expect(400);             // someone else's video
    expect((await rowOf(post.body.id)).status).toBe('QUEUED');
  });

  it('refuses a wider visibility than the app is approved for, an unusable caption, and a connection without posting permission', async () => {
    const w = await workspace();
    await create(w, { privacyLevel: 'PUBLIC_TO_EVERYONE' }).expect(400);
    await create(w, { caption: '   ' }).expect(400);
    await create(w, { caption: 'x'.repeat(2300) }).expect(400);
    const noScope = await workspace({ scope: 'user.info.basic' });
    const r = await create(noScope).expect(400);
    expect(r.body.message).toMatch(/permission to post/);
  });

  it('refuses to queue a post for an account that needs reconnecting', async () => {
    const w = await workspace();
    await testPrisma.channel.update({ where: { id: w.channel.id }, data: { metadata: { tiktokAuth: { status: 'REAUTH_REQUIRED' } } } });
    await create(w).expect(400);
  });

  it('treats a lost answer from TikTok as UNCERTAIN: no automatic retry, and a retry needs confirmation', async () => {
    const w = await workspace();
    const post = (await create(w).expect(201)).body;
    initReply = () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); };
    await run();
    expect(await rowOf(post.id)).toMatchObject({ status: 'UNCERTAIN', publishId: null });
    await run();
    expect(initCalls()).toHaveLength(1);
    const r = await request(app.getHttpServer()).post(`/tiktok/publications/${post.id}/retry`).set('Authorization', w.auth()).send({}).expect(409);
    expect(r.body.message).toMatch(/may already have published/);
    initReply = okInit;
    await request(app.getHttpServer()).post(`/tiktok/publications/${post.id}/retry`).set('Authorization', w.auth()).send({ confirmNotPosted: true }).expect(200);
    await run();
    expect(initCalls()).toHaveLength(2);
    expect((await rowOf(post.id)).status).toBe('PROCESSING');
  });

  it('backs off on a rate limit and gives up after the attempt limit with a reason', async () => {
    const w = await workspace();
    const post = (await create(w).expect(201)).body;
    initReply = () => json({ error: { code: 'rate_limit_exceeded', message: 'slow down' } }, 429);
    await run();
    const first = await rowOf(post.id);
    expect(first).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(first.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    await run();                                                       // not due yet: no second call
    expect(initCalls()).toHaveLength(1);
    await testPrisma.tikTokPublication.update({ where: { id: post.id }, data: { attempts: 4, nextAttemptAt: new Date(Date.now() - 1000) } });
    await run();
    expect(await rowOf(post.id)).toMatchObject({ status: 'FAILED', attempts: 5 });
  });

  it('turns a revoked or invalid token into NEEDS_RECONNECT, and a fresh retry works after reconnecting', async () => {
    const w = await workspace();
    const post = (await create(w).expect(201)).body;
    initReply = () => json({ error: { code: 'access_token_invalid', message: 'bad' } }, 401);
    await run();
    expect(await rowOf(post.id)).toMatchObject({ status: 'NEEDS_RECONNECT' });
    initReply = okInit;
    await request(app.getHttpServer()).post(`/tiktok/publications/${post.id}/retry`).set('Authorization', w.auth()).send({}).expect(200);
    await run();
    expect((await rowOf(post.id)).status).toBe('PROCESSING');
  });

  it('waits for the refresh worker when the access token has expired, then uses the rotated token', async () => {
    const w = await workspace({ expiresInMs: -5_000 });
    const post = (await create(w).expect(201)).body;
    await run();
    expect(tiktok).toHaveLength(0);
    expect(await rowOf(post.id)).toMatchObject({ status: 'QUEUED', attempts: 0 });
    // The refresh worker stores a rotated token pair.
    const enc = app.get(CredentialsEncryptionService);
    const ch = await testPrisma.channel.findUniqueOrThrow({ where: { id: w.channel.id } });
    await testPrisma.channel.update({ where: { id: w.channel.id }, data: { credentials: { ...(ch.credentials as object), accessToken: enc.encrypt('ROTATED-ACCESS-TOKEN-0000-2'), tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() } } });
    await testPrisma.tikTokPublication.update({ where: { id: post.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await run();
    expect(initCalls()[0]!.headers['Authorization']).toBe('Bearer ROTATED-ACCESS-TOKEN-0000-2');
  });

  it('records TikTok\'s own failure reason and does not repost', async () => {
    const w = await workspace();
    const post = (await create(w).expect(201)).body;
    await run();
    statusReply = () => json({ data: { status: 'FAILED', fail_reason: 'frame_rate_check_failed' }, error: { code: 'ok' } });
    await testPrisma.tikTokPublication.update({ where: { id: post.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await run();
    const row = await rowOf(post.id);
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toMatch(/23 and 60 fps/);
    expect(initCalls()).toHaveLength(1);
  });

  it('a revoked token after upload still never reposts: it resumes status checks only', async () => {
    const w = await workspace();
    const post = (await create(w).expect(201)).body;
    await run();
    statusReply = () => json({ error: { code: 'access_token_invalid' } }, 401);
    await testPrisma.tikTokPublication.update({ where: { id: post.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await run();
    expect(await rowOf(post.id)).toMatchObject({ status: 'NEEDS_RECONNECT', publishId: 'v_pub_1' });
    statusReply = () => json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['9'] }, error: { code: 'ok' } });
    await request(app.getHttpServer()).post(`/tiktok/publications/${post.id}/retry`).set('Authorization', w.auth()).send({}).expect(200);
    await run();
    expect(await rowOf(post.id)).toMatchObject({ status: 'PUBLISHED' });
    expect(initCalls()).toHaveLength(1);
  });

  it('marks an interrupted run: UNCERTAIN before TikTok gave an id, FAILED after it did', async () => {
    const w = await workspace();
    const past = new Date(Date.now() - 60_000);
    const mk = (publishId: string | null, key: string) => testPrisma.tikTokPublication.create({ data: { tenantId: w.tenant.id, channelId: w.channel.id, idempotencyKey: key, caption: 'c', privacyLevel: 'SELF_ONLY', mediaKey: w.mediaKey, status: 'UPLOADING', publishId, leaseOwner: 'dead', leaseExpiresAt: past, attempts: 1 } });
    const a = await mk(null, 'k1'); const b = await mk('v_pub_x', 'k2');
    await run();
    expect((await rowOf(a.id)).status).toBe('UNCERTAIN');
    expect((await rowOf(b.id)).status).toBe('FAILED');
    expect(tiktok).toHaveLength(0);
  });

  it('leaves queued posts untouched while the flag is off, and lets only unstarted posts be cancelled', async () => {
    const w = await workspace();
    const queued = (await create(w).expect(201)).body;
    await testPrisma.featureFlag.update({ where: { key: 'tiktok_publishing' }, data: { enabled: false } });
    (app.get(FeatureFlagsService) as unknown as { cache: Map<string, unknown> }).cache.clear();
    await run();
    expect(tiktok).toHaveLength(0);
    expect((await rowOf(queued.id)).status).toBe('QUEUED');
    await request(app.getHttpServer()).post(`/tiktok/publications/${queued.id}/cancel`).set('Authorization', w.auth()).expect(200);
    expect((await rowOf(queued.id)).status).toBe('CANCELLED');
    await request(app.getHttpServer()).post(`/tiktok/publications/${queued.id}/cancel`).set('Authorization', w.auth()).expect(409);
  });

  it('stops before uploading when the account cannot post with that visibility, and says what it can use', async () => {
    const w = await workspace();
    process.env['TIKTOK_PUBLISH_ALLOWED_PRIVACY'] = 'SELF_ONLY,PUBLIC_TO_EVERYONE';
    try {
      const post = (await create(w, { privacyLevel: 'PUBLIC_TO_EVERYONE' }).expect(201)).body;
      await run();
      const row = await rowOf(post.id);
      expect(row.status).toBe('FAILED');
      expect(row.lastError).toMatch(/cannot post with that visibility. It allows: Only me, Friends/);
      expect(initCalls()).toHaveLength(0);
    } finally { delete process.env['TIKTOK_PUBLISH_ALLOWED_PRIVACY']; }
  });

  it('stops at TikTok\'s posting limits, which arrive as HTTP 200, without sending the video', async () => {
    for (const code of ['spam_risk_too_many_posts', 'spam_risk_user_banned_from_posting', 'reached_active_user_cap']) {
      const w = await workspace();
      creatorReply = () => json({ data: {}, error: { code, message: 'limit' } });
      const post = (await create(w).expect(201)).body;
      await run();
      expect(await rowOf(post.id)).toMatchObject({ status: 'FAILED' });
      expect(tiktok.some((c) => c.method === 'PUT')).toBe(false);
    }
    expect(initCalls()).toHaveLength(0);
  });

  it('retries later when the creator query cannot be answered (it changes nothing at TikTok), and reconnects on a rejected token', async () => {
    const w = await workspace();
    creatorReply = () => new Response('<html>', { status: 502 });
    const post = (await create(w).expect(201)).body;
    await run();
    expect(await rowOf(post.id)).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(initCalls()).toHaveLength(0);
    creatorReply = () => json({ error: { code: 'access_token_invalid' } }, 401);
    await testPrisma.tikTokPublication.update({ where: { id: post.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await run();
    expect(await rowOf(post.id)).toMatchObject({ status: 'NEEDS_RECONNECT' });
  });

  it('turns TikTok\'s documented failure reasons into plain advice; a removed authorisation ends the post and never reposts', async () => {
    const w = await workspace();
    const post = (await create(w).expect(201)).body;
    await run();
    statusReply = () => json({ data: { status: 'FAILED', fail_reason: 'auth_removed' }, error: { code: 'ok' } });
    await testPrisma.tikTokPublication.update({ where: { id: post.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await run();
    const row = await rowOf(post.id);
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toMatch(/removed this app's access on TikTok. Reconnect/);
    expect(initCalls()).toHaveLength(1);
  });

  it('treats an upload TikTok does not acknowledge with 201 as failed, never as processing', async () => {
    const w = await workspace(); putStatus = 206;
    const post = (await create(w).expect(201)).body;
    await run();
    const row = await rowOf(post.id);
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toMatch(/expected 201/);
  });

  it('fails clearly for a file TikTok does not accept, without calling TikTok', async () => {
    const w = await workspace();
    (app.get(StorageService).downloadBuffer as jest.Mock).mockResolvedValue({ buffer: video, mimeType: 'image/png' });
    const post = (await create(w).expect(201)).body;
    await run();
    expect(await rowOf(post.id)).toMatchObject({ status: 'FAILED' });
    expect((await rowOf(post.id)).lastError).toMatch(/MP4, MOV or WebM/);
    expect(tiktok).toHaveLength(0);
  });
});
