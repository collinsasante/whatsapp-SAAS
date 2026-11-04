import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

/**
 * Regression: the app-wide ValidationPipe (implicit conversion on) turned the string "false" into `true` before validation, so a settings request carrying
 * "false" switched the setting ON. Found by exercising the running server; fixed with StrictBoolean. The stored value is what is asserted, not just the status.
 */
describe('boolean settings are not coerced (e2e, same pipe options as main.ts)', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestingApp({ validation: true }); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(resetTestDatabase);

  async function patch(body: object) {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    await testPrisma.tenantSettings.create({ data: { tenantId: tenant.id, imageUnderstandingEnabled: false, voiceTranscriptionEnabled: true } });
    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });
    const res = await request(app.getHttpServer()).patch('/tenant/settings').set('Authorization', `Bearer ${token}`).send(body);
    const stored = await testPrisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    return { res, stored };
  }

  it('stores a real boolean exactly as sent', async () => {
    const on = await patch({ imageUnderstandingEnabled: true });
    expect(on.res.status).toBe(200);
    expect(on.stored.imageUnderstandingEnabled).toBe(true);
    const off = await patch({ voiceTranscriptionEnabled: false });
    expect(off.res.status).toBe(200);
    expect(off.stored.voiceTranscriptionEnabled).toBe(false);
  });

  it('reads the strings "true" and "false" for what they say (never as truthy text)', async () => {
    const f = await patch({ voiceTranscriptionEnabled: 'false' });
    expect(f.res.status).toBe(200);
    expect(f.stored.voiceTranscriptionEnabled).toBe(false);          // used to become true
    const t = await patch({ imageUnderstandingEnabled: 'true' });
    expect(t.stored.imageUnderstandingEnabled).toBe(true);
  });

  it.each(['yes', 'no', 'on', '0', '1', 0, 1, 2, {}, [], 'TRUE'])('rejects %p with 400 and changes nothing', async (value) => {
    const { res, stored } = await patch({ imageUnderstandingEnabled: value });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toMatch(/must be a boolean/);
    expect(stored.imageUnderstandingEnabled).toBe(false);            // unchanged default
  });
});
