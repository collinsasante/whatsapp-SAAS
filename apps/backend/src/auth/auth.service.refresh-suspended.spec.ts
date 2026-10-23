import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Suspending a workspace or a user in the admin console has to end their access, not just block new sign-ins. A session
 * is kept alive by two things, the access token (checked on every request) and the refresh token (exchanged for new
 * access tokens for weeks), so both are covered here.
 */
describe('suspended workspaces and users cannot keep a session', () => {
  const REFRESH_TOKEN = 'a-real-looking-refresh-token';
  let storedHash: string;
  beforeAll(async () => { storedHash = await bcrypt.hash(REFRESH_TOKEN, 4); });

  function authService(opts: { userActive?: boolean; tenantActive?: boolean | null }) {
    const user = { id: 'u1', email: 'a@example.com', tenantId: 't1', role: 'AGENT', isActive: opts.userActive ?? true, refreshToken: storedHash };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue(user) },
      workspaceMember: { findFirst: jest.fn().mockResolvedValue({ role: 'AGENT' }) },
      tenant: { findUnique: jest.fn().mockResolvedValue(opts.tenantActive === null ? null : { isActive: opts.tenantActive ?? true }) },
    };
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 'u1', tenantId: 't1', email: user.email, role: 'AGENT' }), signAsync: jest.fn().mockResolvedValue('signed') };
    const config = { get: jest.fn((_k: string, fallback?: unknown) => fallback) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new AuthService(prisma as any, jwt as any, config as any, { log: jest.fn() } as any, {} as any);
  }

  it('refreshes a session for an active user in an active workspace', async () => {
    await expect(authService({}).refreshTokens(REFRESH_TOKEN)).resolves.toBeDefined();
  });

  it('refuses to refresh when the workspace is suspended', async () => {
    await expect(authService({ tenantActive: false }).refreshTokens(REFRESH_TOKEN)).rejects.toThrow(UnauthorizedException);
  });

  it('refuses to refresh when the workspace no longer exists', async () => {
    await expect(authService({ tenantActive: null }).refreshTokens(REFRESH_TOKEN)).rejects.toThrow(UnauthorizedException);
  });

  it('refuses to refresh when the user is suspended', async () => {
    await expect(authService({ userActive: false }).refreshTokens(REFRESH_TOKEN)).rejects.toThrow(UnauthorizedException);
  });

  describe('access token check', () => {
    function strategy(tenant: { isActive: boolean } | null) {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@example.com', tenantId: 't1', role: 'AGENT', isActive: true }) },
        workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
        tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
      };
      const config = { get: jest.fn().mockReturnValue('secret') };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { strategy: new JwtStrategy(config as any, prisma as any), prisma };
    }
    const payload = { sub: 'u1', email: 'a@example.com', tenantId: 't1', role: 'AGENT' } as never;

    it('lets a request through for an active workspace', async () => {
      await expect(strategy({ isActive: true }).strategy.validate(payload)).resolves.toMatchObject({ sub: 'u1', tenantId: 't1' });
    });
    it('rejects a request for a suspended workspace even though the token is valid', async () => {
      await expect(strategy({ isActive: false }).strategy.validate(payload)).rejects.toThrow('This workspace has been suspended');
    });
    it('rejects a request for a workspace that no longer exists', async () => {
      await expect(strategy(null).strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });
    it('looks up the workspace the token is for, not only the user\'s home workspace', async () => {
      const { strategy: s, prisma } = strategy({ isActive: true });
      await s.validate({ sub: 'u1', email: 'a@example.com', tenantId: 't1', role: 'AGENT' } as never);
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 't1' }, select: { isActive: true } });
    });
  });
});
