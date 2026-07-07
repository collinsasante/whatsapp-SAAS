import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { createTenantWithUser, resetTestDatabase, disconnectTestDatabase } from './utils/test-db';

/**
 * Hard requirement: it must be impossible for any tenant user, including tenant
 * admins/owners, to reach any platform-admin endpoint. The PlatformAdminGuard
 * checks for a `role: 'platform_admin'` JWT claim that a tenant's own JWT never
 * has -- this proves that holds for every guarded route, not just one.
 */
describe('Platform admin endpoints reject tenant users (e2e)', () => {
  let app: INestApplication;
  const fakeId = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => { app = await createTestingApp(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  beforeEach(async () => { await resetTestDatabase(); });

  const routes: { method: 'get' | 'post' | 'patch'; path: string }[] = [
    { method: 'get', path: '/platform-admin/auth/me' },
    { method: 'get', path: '/platform-admin/dashboard' },
    { method: 'get', path: '/platform-admin/workspaces' },
    { method: 'get', path: `/platform-admin/workspaces/${fakeId}` },
    { method: 'patch', path: `/platform-admin/workspaces/${fakeId}` },
    { method: 'patch', path: `/platform-admin/workspaces/${fakeId}/suspend` },
    { method: 'patch', path: `/platform-admin/workspaces/${fakeId}/activate` },
    { method: 'get', path: '/platform-admin/billing/invoices' },
    { method: 'get', path: '/platform-admin/plans' },
    { method: 'post', path: '/platform-admin/plans' },
    { method: 'patch', path: `/platform-admin/plans/${fakeId}` },
    { method: 'patch', path: `/platform-admin/workspaces/${fakeId}/force-plan` },
    { method: 'get', path: `/platform-admin/workspaces/${fakeId}/templates` },
    { method: 'get', path: '/platform-admin/users' },
    { method: 'patch', path: `/platform-admin/users/${fakeId}/toggle-active` },
  ];

  it.each(routes)('$method $path returns 403 for a tenant ADMIN', async ({ method, path }) => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.ADMIN });
    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.ADMIN });

    await request(app.getHttpServer())[method](path)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('rejects a tenant AGENT the same way', async () => {
    const { tenant, user } = await createTenantWithUser({ role: UserRole.AGENT });
    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role: UserRole.AGENT });

    await request(app.getHttpServer())
      .get('/platform-admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('rejects requests with no token at all (401, not 403 -- unauthenticated vs unauthorized)', async () => {
    await request(app.getHttpServer()).get('/platform-admin/dashboard').expect(401);
  });
});
