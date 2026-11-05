import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import axios, { AxiosError } from 'axios';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

// The credit checkout is the one place a customer pays, so a provider or configuration problem must reach the user as an
// honest, recoverable error. It once reached them as a 401, which the web app reads as an expired session.
describe('Credit checkout error handling (e2e)', () => {
  let app: INestApplication;
  const originalKey = process.env['PAYSTACK_SECRET_KEY'];

  afterEach(async () => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env['PAYSTACK_SECRET_KEY'];
    else process.env['PAYSTACK_SECRET_KEY'] = originalKey;
    await app?.close();
  });
  afterAll(async () => {
    await disconnectTestDatabase();
  });

  async function setup(opts: { paystackKey?: string; role?: UserRole } = {}) {
    await resetTestDatabase();
    if (opts.paystackKey === undefined) delete process.env['PAYSTACK_SECRET_KEY'];
    else process.env['PAYSTACK_SECRET_KEY'] = opts.paystackKey;
    app = await createTestingApp({ validation: true, exceptionFilter: true });
    const role = opts.role ?? UserRole.ADMIN;
    const { tenant, user } = await createTenantWithUser({ role });
    await testPrisma.aiCreditPackage.create({ data: { slug: 'starter', name: 'Starter', credits: 1000, priceGhs: 10, priceUsd: 1 } });
    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role });
    return { tenant, token };
  }

  const checkout = (token: string | undefined) => {
    const req = request(app.getHttpServer()).post('/billing/credits/checkout/paystack').send({ packSlug: 'starter', billingEmail: 'buyer@example.com' });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('with no Paystack key configured: a clean 503, no call to Paystack, and nothing recorded as a pending purchase', async () => {
    const { token } = await setup();
    const post = jest.spyOn(axios, 'post');

    const res = await checkout(token).expect(503);

    expect(JSON.stringify(res.body)).toMatch(/not available right now/i);
    expect(JSON.stringify(res.body)).not.toMatch(/PAYSTACK|secret|key/i);
    expect(post).not.toHaveBeenCalled();
    expect(await testPrisma.creditPurchase.count()).toBe(0);
    expect(await testPrisma.payment.count()).toBe(0);
  });

  it('when Paystack rejects our key with 401, the user gets a 502, not a 401 that looks like an expired session', async () => {
    const { token } = await setup({ paystackKey: 'sk_test_rejected' });
    jest.spyOn(axios, 'post').mockRejectedValue(new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', undefined, undefined, { status: 401, data: { message: 'Invalid key' } } as never));

    const res = await checkout(token).expect(502);

    expect(res.body.message).toBe('A request to an external service failed. Please try again shortly.');
    expect(JSON.stringify(res.body)).not.toMatch(/Invalid key|status code|sk_test/);
    expect(await testPrisma.creditPurchase.count()).toBe(0);
  });

  it('a genuinely unauthenticated request is still a 401, so session handling is unaffected', async () => {
    await setup();
    await checkout(undefined).expect(401);
  });

  it('a VIEWER cannot start a purchase', async () => {
    const { token } = await setup({ paystackKey: 'sk_test_x', role: UserRole.VIEWER });
    const post = jest.spyOn(axios, 'post');
    await checkout(token).expect(403);
    expect(post).not.toHaveBeenCalled();
  });

  it('an unknown pack is a 400 naming the problem, not a provider call', async () => {
    const { token } = await setup({ paystackKey: 'sk_test_x' });
    const post = jest.spyOn(axios, 'post');
    const res = await request(app.getHttpServer()).post('/billing/credits/checkout/paystack').set('Authorization', `Bearer ${token}`).send({ packSlug: 'does-not-exist' }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/invalid credit pack/i);
    expect(post).not.toHaveBeenCalled();
  });
});
