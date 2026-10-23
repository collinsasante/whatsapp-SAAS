import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { toPublicChannel } from './channel-public.util';

const SECRETS = ['123456:TELEGRAM-BOT-TOKEN', 'EAAB-instagram-page-token', 'tiktok-access-token-xyz', 'tiktok-refresh-token-xyz'];

const rowWithTokens = (over: object = {}) => ({
  id: 'c1', tenantId: 't1', type: 'TELEGRAM', name: '@bot', isActive: true, externalId: '123456', metadata: {},
  credentials: { botToken: SECRETS[0], accessToken: SECRETS[1], tiktok: SECRETS[2], refreshToken: SECRETS[3], externalId: '123456' },
  ...over,
});

class FakeAuth implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { sub: 'u1', tenantId: 't1', role: req.headers['x-role'] ?? 'VIEWER' };
    req.tenantId = 't1';
    return true;
  }
}

describe('toPublicChannel', () => {
  it('drops credentials, keeps everything else, and says whether any were stored', () => {
    const out = toPublicChannel(rowWithTokens());
    expect(out).not.toHaveProperty('credentials');
    expect(out).toMatchObject({ id: 'c1', name: '@bot', type: 'TELEGRAM', isActive: true, hasCredentials: true });
  });
  it.each([[{}], [null], [undefined]])('hasCredentials is false for %p', (credentials) => {
    expect(toPublicChannel({ id: 'c', credentials })).toEqual({ id: 'c', hasCredentials: false });
  });
});

describe('Channels API responses never contain stored tokens', () => {
  let app: INestApplication;
  const service = {
    findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), toggle: jest.fn(),
    connectTelegramBot: jest.fn(), remove: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ChannelsController],
      providers: [{ provide: ChannelsService, useValue: service }, { provide: ConfigService, useValue: { get: jest.fn() } }],
    }).overrideGuard(JwtAuthGuard).useClass(FakeAuth).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    service.findAll.mockResolvedValue([rowWithTokens(), rowWithTokens({ id: 'c2', type: 'INSTAGRAM', name: '@shop' })]);
    for (const k of ['findOne', 'create', 'update', 'toggle', 'connectTelegramBot']) (service as Record<string, jest.Mock>)[k].mockResolvedValue(rowWithTokens());
  });

  const expectNoSecrets = (body: unknown) => {
    const text = JSON.stringify(body);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain('credentials');
  };

  it('GET /channels (any workspace member, including a viewer)', async () => {
    const res = await request(app.getHttpServer()).get('/channels').set('x-role', 'VIEWER');
    expect(res.status).toBe(200);
    expectNoSecrets(res.body);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'c1', name: '@bot', hasCredentials: true });
  });

  it('GET /channels/:id', async () => {
    const res = await request(app.getHttpServer()).get('/channels/c1').set('x-role', 'AGENT');
    expect(res.status).toBe(200);
    expectNoSecrets(res.body);
  });

  it.each([
    ['post', '/channels', { type: 'TELEGRAM', name: 'x' }],
    ['patch', '/channels/c1', { name: 'y' }],
    ['patch', '/channels/c1/toggle', undefined],
    ['post', '/channels/telegram/connect', { botToken: 'x' }],
  ])('admin %s %s returns the saved channel without its tokens', async (method, url, body) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = (request(app.getHttpServer()) as any)[method](url).set('x-role', 'ADMIN');
    const res = await (body ? req.send(body) : req);
    expect(res.status).toBeLessThan(300);
    expectNoSecrets(res.body);
  });
});
