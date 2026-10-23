import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { UserRole } from '@whatsapp-platform/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';

// Stands in for JwtAuthGuard/JwtStrategy, which put the database-derived workspace and role on request.user.
class FakeAuth implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (!req.headers['x-role']) return false;
    req.user = { sub: 'u1', tenantId: req.headers['x-tenant'] ?? 'tenant-A', role: req.headers['x-role'] };
    return true;
  }
}

const WRITE_ROUTES: Array<[string, string, object | undefined]> = [
  ['post', '/knowledge-base', { title: 'a', content: 'b' }],
  ['patch', '/knowledge-base/a1', { title: 'a' }],
  ['delete', '/knowledge-base/a1', undefined],
  ['post', '/knowledge-base/learn', undefined],
  ['post', '/knowledge-base/deduplicate', undefined],
  ['post', '/knowledge-base/upload', undefined],
  ['post', '/knowledge-base/scrape', { url: 'https://example.com' }],
];

describe('KnowledgeBaseController permissions (real RolesGuard, mocked service)', () => {
  let app: INestApplication;
  const service = {
    list: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined), learnNow: jest.fn().mockResolvedValue({ created: 0 }),
    deduplicateArticles: jest.fn().mockResolvedValue({}), uploadFile: jest.fn().mockResolvedValue({}), scrapeUrl: jest.fn().mockResolvedValue({ created: 0 }),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [KnowledgeBaseController], providers: [{ provide: KnowledgeBaseService, useValue: service }] })
      .overrideGuard(JwtAuthGuard).useClass(FakeAuth)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => Object.values(service).forEach((fn) => fn.mockClear()));

  const send = (method: string, url: string, body: object | undefined, role?: string, tenant?: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r = (request(app.getHttpServer()) as any)[method](url);
    if (role) r = r.set('x-role', role);
    if (tenant) r = r.set('x-tenant', tenant);
    return body ? r.send(body) : r;
  };

  it.each(WRITE_ROUTES)('%s %s: AGENT and VIEWER get 403 and nothing runs', async (method, url, body) => {
    for (const role of [UserRole.AGENT, UserRole.VIEWER]) {
      const res = await send(method, url, body, role);
      expect(res.status).toBe(403);
    }
    Object.values(service).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it.each(WRITE_ROUTES)('%s %s: an unauthenticated request is refused and nothing runs', async (method, url, body) => {
    const res = await send(method, url, body);
    expect(res.status).toBe(403);
    Object.values(service).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('admins can learn and scrape, and the call is made for the admin\'s own workspace', async () => {
    expect((await send('post', '/knowledge-base/learn', undefined, UserRole.ADMIN, 'tenant-A')).status).toBe(201);
    expect(service.learnNow).toHaveBeenCalledWith('tenant-A');
    expect((await send('post', '/knowledge-base/scrape', { url: 'https://example.com' }, UserRole.ADMIN, 'tenant-B')).status).toBe(201);
    expect(service.scrapeUrl).toHaveBeenCalledWith('tenant-B', 'https://example.com');
  });

  it('super admins pass too (the hierarchy puts them above admins)', async () => {
    expect((await send('post', '/knowledge-base/learn', undefined, UserRole.SUPER_ADMIN)).status).toBe(201);
  });

  it('every workspace member can still read the list, scoped to their own workspace', async () => {
    for (const role of [UserRole.VIEWER, UserRole.AGENT, UserRole.ADMIN]) {
      expect((await send('get', '/knowledge-base', undefined, role, 'tenant-B')).status).toBe(200);
    }
    expect(service.list).toHaveBeenCalledWith('tenant-B');
  });

  it('the learn and scrape routes carry their own rate limits', () => {
    const keys = (name: string) => Reflect.getMetadataKeys(KnowledgeBaseController.prototype[name as keyof KnowledgeBaseController] as object).filter((k: string) => String(k).startsWith('THROTTLER'));
    expect(keys('learnFromConversations').length).toBeGreaterThan(0);
    expect(keys('scrapeUrl').length).toBeGreaterThan(0);
  });
});
