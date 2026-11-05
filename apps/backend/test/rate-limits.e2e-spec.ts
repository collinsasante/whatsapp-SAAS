import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

// Each test builds its own app: the throttler keeps its counters in the app instance, so a fresh one starts every test with empty buckets.
describe('API rate limits (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    await resetTestDatabase();
    app = await createTestingApp({ validation: true });
    // Same as src/main.ts: one trusted proxy hop (nginx), so req.ip is the address nginx appended to X-Forwarded-For.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(async () => {
    await disconnectTestDatabase();
  });

  const post = (path: string, body: object, forwardedFor?: string) => {
    const req = request(app.getHttpServer()).post(path).send(body);
    return forwardedFor ? req.set('X-Forwarded-For', forwardedFor) : req;
  };

  async function hammer(path: string, body: object, times: number, forwardedFor?: string): Promise<number[]> {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) statuses.push((await post(path, body, forwardedFor)).status);
    return statuses;
  }

  describe.each([
    ['/auth/login', { email: 'nobody@example.com', password: 'wrong-password-1' }, 10],
    ['/auth/register', { name: 'x', email: 'bad', password: 'short' }, 5],
    ['/auth/forgot-password', { email: 'nobody@example.com' }, 5],
    ['/auth/resend-verification', { email: 'nobody@example.com' }, 3],
    ['/auth/verify-2fa', { tempToken: 'not-a-token', code: '000000' }, 5],
    ['/auth/setup-pin', { tempToken: 'not-a-token', pin: '123456' }, 5],
  ] as const)('%s', (path, body, limit) => {
    it(`answers 429 from request ${limit + 1} and never before`, async () => {
      const statuses = await hammer(path, body, limit + 2);
      expect(statuses.slice(0, limit).every((s) => s !== 429)).toBe(true);
      expect(statuses[limit]).toBe(429);
      expect(statuses[limit + 1]).toBe(429);
    });
  });

  it('a failed login is a normal 4xx, so only the limiter (not an error) stops a guessing run', async () => {
    const statuses = await hammer('/auth/login', { email: 'nobody@example.com', password: 'wrong-password-1' }, 3);
    expect(statuses.every((s) => s >= 400 && s < 500 && s !== 429)).toBe(true);
  });

  describe('client address handling behind the proxy', () => {
    const login = { email: 'nobody@example.com', password: 'wrong-password-1' };

    it('a client cannot dodge the limit by forging the left side of X-Forwarded-For', async () => {
      // nginx appends the real peer address as the LAST entry; anything to its left is client-supplied.
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await post('/auth/login', login, `10.0.0.${i}, 203.0.113.7`)).status);
      expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it('a different real client is not throttled by someone else\'s requests', async () => {
      await hammer('/auth/login', login, 11, '203.0.113.7');
      expect((await post('/auth/login', login, '203.0.113.7')).status).toBe(429);
      expect((await post('/auth/login', login, '198.51.100.9')).status).not.toBe(429);
    });
  });

  describe('global default on authenticated and token endpoints', () => {
    it('limits an endpoint with no specific decorator (mobile token refresh) to the global default per minute', async () => {
      const limit = Number(process.env['THROTTLE_LIMIT'] ?? 100);
      const statuses: number[] = [];
      for (let i = 0; i < limit + 1; i++) statuses.push((await request(app.getHttpServer()).post('/auth/mobile/refresh').set('x-refresh-token', 'not-a-token')).status);
      expect(statuses.slice(0, limit).every((s) => s !== 429)).toBe(true);
      expect(statuses[limit]).toBe(429);
    }, 120_000);

    it('limits authenticated reads too, per client address', async () => {
      const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
      const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
      const limit = Number(process.env['THROTTLE_LIMIT'] ?? 100);
      let last = 0;
      for (let i = 0; i < limit + 1; i++) {
        last = (await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`)).status;
      }
      expect(last).toBe(429);
    }, 120_000);
  });

  describe('public checkout (unauthenticated, reference-keyed)', () => {
    it('allows 30 lookups a minute per client and refuses the 31st, counting each request once', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 32; i++) statuses.push((await request(app.getHttpServer()).get('/pay/does-not-exist')).status);
      expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
      expect(statuses[30]).toBe(429);
    }, 120_000);
  });

  describe('the media route that serves many thumbnails has its own, higher limit', () => {
    it('is not cut off at the global default', async () => {
      const global = Number(process.env['THROTTLE_LIMIT'] ?? 100);
      let throttled = 0;
      for (let i = 0; i < global + 20; i++) {
        const res = await request(app.getHttpServer()).get('/media/serve/tenant~missing.png');
        if (res.status === 429) throttled++;
      }
      expect(throttled).toBe(0);
    }, 120_000);
  });
});
