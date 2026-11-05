import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '@whatsapp-platform/shared-types';
import { createTestingApp, signTestToken } from './utils/test-app';
import { testPrisma, resetTestDatabase, createTenantWithUser, disconnectTestDatabase } from './utils/test-db';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const MB = 1024 * 1024;

describe('Media upload security (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestingApp();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function actor(role: UserRole = UserRole.ADMIN) {
    const { tenant, user } = await createTenantWithUser({ role });
    const token = signTestToken(app, { sub: user.id, email: user.email, tenantId: tenant.id, role });
    return { tenant, user, token };
  }

  const upload = (token: string | undefined, bytes: Buffer, mimetype: string, filename = 'file.bin') => {
    const req = request(app.getHttpServer()).post('/media/upload');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.attach('file', bytes, { filename, contentType: mimetype });
  };

  describe('authentication and roles', () => {
    it('rejects an unauthenticated upload', async () => {
      await upload(undefined, PNG, 'image/png', 'a.png').expect(401);
    });

    it('rejects a VIEWER, who has read-only access', async () => {
      const { token } = await actor(UserRole.VIEWER);
      await upload(token, PNG, 'image/png', 'a.png').expect(403);
      expect(await testPrisma.mediaAsset.count()).toBe(0);
    });

    it('accepts an AGENT', async () => {
      const { token } = await actor(UserRole.AGENT);
      await upload(token, PNG, 'image/png', 'a.png').expect(201);
    });
  });

  describe('type and content validation', () => {
    it('stores a genuine PNG against the caller\'s tenant and classifies it as IMAGE', async () => {
      const { token, tenant } = await actor();
      const res = await upload(token, PNG, 'image/png', 'logo.png').expect(201);
      expect(res.body.type).toBe('IMAGE');
      expect(res.body.fileKey.startsWith(`${tenant.id}/`)).toBe(true);
      expect(res.body.fileKey.endsWith('.png')).toBe(true);
      const row = await testPrisma.mediaAsset.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.tenantId).toBe(tenant.id);
    });

    it.each([
      ['text/html', Buffer.from('<html><script>alert(1)</script></html>')],
      ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
      ['application/javascript', Buffer.from('alert(1)')],
      ['application/x-msdownload', Buffer.from('MZ')],
    ])('rejects a declared %s outright', async (mimetype, bytes) => {
      const { token } = await actor();
      const res = await upload(token, bytes, mimetype, 'x.bin').expect(400);
      expect(res.body.message ?? res.body.error).toBeDefined();
      expect(await testPrisma.mediaAsset.count()).toBe(0);
    });

    it.each([
      ['HTML declared as image/png', 'image/png', Buffer.from('<html><script>alert(1)</script></html>')],
      ['an ASF container declared as audio/ogg', 'audio/ogg', Buffer.from('3026b2758e66cf11a6d900aa0062ce6c0000000000000000', 'hex')],
      ['a script declared as text/plain', 'text/plain', Buffer.from('#!/bin/sh\nrm -rf /')],
      ['a Windows executable declared as application/pdf', 'application/pdf', Buffer.from('MZ\x90\x00\x03\x00')],
    ])('rejects %s even though the declared type is allowed', async (_label, mimetype, bytes) => {
      const { token } = await actor();
      await upload(token, bytes, mimetype, 'renamed.bin').expect(400);
      expect(await testPrisma.mediaAsset.count()).toBe(0);
    });

    it('rejects a request with no file part', async () => {
      const { token } = await actor();
      await request(app.getHttpServer()).post('/media/upload').set('Authorization', `Bearer ${token}`).expect(400);
    });

    it('rejects an unexpected extra file part', async () => {
      const { token } = await actor();
      await request(app.getHttpServer())
        .post('/media/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
        .attach('file', PNG, { filename: 'b.png', contentType: 'image/png' })
        .expect((res) => expect(res.status).toBeGreaterThanOrEqual(400));
    });
  });

  describe('file names and storage keys', () => {
    it.each(['../../etc/passwd.png', '..\\..\\windows\\evil.png', 'a/b/c.png', '.htaccess.png', 'x.png\u0000.exe'])(
      'a hostile file name (%j) never influences where the file is stored',
      async (filename) => {
        const { token, tenant } = await actor();
        const res = await upload(token, PNG, 'image/png', filename);
        // Either the stack refuses the name or it stores under a generated key; it must never honour the name as a path.
        if (res.status === 201) {
          expect(res.body.fileKey).toMatch(new RegExp(`^${tenant.id}/[0-9a-f-]{36}(\\.[a-z0-9]{1,10})?$`));
        } else {
          expect(res.status).toBeGreaterThanOrEqual(400);
        }
      },
    );

    it('does not serve path-traversal keys on the public serve route', async () => {
      for (const key of ['..~..~etc~passwd', '%2e%2e~%2e%2e~etc~passwd', '.hidden', 'a~..~b', '~etc~passwd']) {
        const res = await request(app.getHttpServer()).get(`/media/serve/${key}`);
        expect([400, 404]).toContain(res.status);
      }
    });
  });

  describe('size ceilings', () => {
    it('refuses an image over 16 MB with 413 and stores nothing', async () => {
      const { token } = await actor();
      const big = Buffer.concat([PNG, Buffer.alloc(17 * MB)]);
      await upload(token, big, 'image/png', 'big.png').expect(413);
      expect(await testPrisma.mediaAsset.count()).toBe(0);
    }, 60_000);

    it('accepts an image just under the ceiling', async () => {
      const { token } = await actor();
      const ok = Buffer.concat([PNG, Buffer.alloc(8 * MB)]);
      await upload(token, ok, 'image/png', 'ok.png').expect(201);
    }, 60_000);
  });

  describe('tenant isolation', () => {
    it('tenant B cannot list, read or delete tenant A\'s asset', async () => {
      const a = await actor();
      const b = await actor();
      const created = await upload(a.token, PNG, 'image/png', 'a.png').expect(201);

      const listB = await request(app.getHttpServer()).get('/media').set('Authorization', `Bearer ${b.token}`).expect(200);
      expect(listB.body.data).toHaveLength(0);
      const listA = await request(app.getHttpServer()).get('/media').set('Authorization', `Bearer ${a.token}`).expect(200);
      expect(listA.body.data).toHaveLength(1);

      await request(app.getHttpServer()).delete(`/media/${created.body.id}`).set('Authorization', `Bearer ${b.token}`).expect(404);
      expect(await testPrisma.mediaAsset.count({ where: { id: created.body.id } })).toBe(1);

      await request(app.getHttpServer()).delete(`/media/${created.body.id}`).set('Authorization', `Bearer ${a.token}`).expect(200);
      expect(await testPrisma.mediaAsset.count()).toBe(0);
    });

    it('the same file name in two tenants does not collide in the library', async () => {
      const a = await actor();
      const b = await actor();
      await request(app.getHttpServer()).post('/media/upload?uniqueName=true').set('Authorization', `Bearer ${a.token}`).attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' }).expect(201);
      await request(app.getHttpServer()).post('/media/upload?uniqueName=true').set('Authorization', `Bearer ${b.token}`).attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' }).expect(201);
      await request(app.getHttpServer()).post('/media/upload?uniqueName=true').set('Authorization', `Bearer ${a.token}`).attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' }).expect(400);
    });
  });

  describe('serving', () => {
    it('serves an uploaded image with nosniff and no attachment disposition, and a document as an attachment', async () => {
      const { token } = await actor();
      const img = await upload(token, PNG, 'image/png', 'a.png').expect(201);
      const served = await request(app.getHttpServer()).get(`/media/serve/${String(img.body.fileKey).replace(/\//g, '~')}`).expect(200);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['content-type']).toContain('image/png');
      expect(served.headers['content-disposition']).toBeUndefined();

      const doc = await upload(token, Buffer.from('plain notes'), 'text/plain', 'n.txt').expect(201);
      const servedDoc = await request(app.getHttpServer()).get(`/media/serve/${String(doc.body.fileKey).replace(/\//g, '~')}`).expect(200);
      expect(servedDoc.headers['content-disposition']).toBe('attachment');
      expect(servedDoc.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});
