import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

/**
 * Focused coverage for a real bug fix: lastSeenAt used to be touched only at
 * login, so an agent whose access token keeps getting silently refreshed
 * throughout a long active session (the normal case -- refresh tokens last
 * up to 90 days) had lastSeenAt frozen at login time. Anything treating a
 * stale lastSeenAt as "this agent is away" -- notably
 * ai-takeover.util.ts's isAgentAway(), consumed by
 * messages.service.ts's AI-human-ownership guard -- would incorrectly
 * conclude an actively-working agent had gone quiet, letting AI auto-reply
 * over them. refreshTokens() now bumps lastSeenAt on every successful
 * refresh.
 */
describe('AuthService.refreshTokens -- lastSeenAt freshness', () => {
  const REFRESH_TOKEN = 'a-real-looking-refresh-token';
  let storedHash: string;

  beforeAll(async () => {
    storedHash = await bcrypt.hash(REFRESH_TOKEN, 4);
  });

  function buildService(overrides: { userUpdate?: jest.Mock } = {}) {
    const user = {
      id: 'user-1',
      email: 'agent@example.com',
      tenantId: 'tenant-1',
      role: 'AGENT',
      refreshToken: storedHash,
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: overrides.userUpdate ?? jest.fn().mockResolvedValue(user),
      },
    };
    const jwtService = {
      verify: jest.fn().mockReturnValue({ sub: user.id, email: user.email, tenantId: user.tenantId, role: user.role }),
      signAsync: jest.fn().mockResolvedValue('signed-token'),
    };
    const configService = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };
    const auditService = { log: jest.fn() };
    const emailService = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AuthService(prisma as any, jwtService as any, configService as any, auditService as any, emailService as any);
    return { service, prisma, user };
  }

  it('updates lastSeenAt on a successful refresh', async () => {
    const { service, prisma, user } = buildService();

    await service.refreshTokens(REFRESH_TOKEN);

    const lastSeenCall = prisma.user.update.mock.calls.find(
      (call) => call[0]?.where?.id === user.id && call[0]?.data?.lastSeenAt instanceof Date,
    );
    expect(lastSeenCall).toBeDefined();
  });

  it('logs a warning (user id + message only, no token) when the lastSeenAt update fails, and still returns tokens', async () => {
    const failingUpdate = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db hiccup'));
    const { service } = buildService({ userUpdate: failingUpdate });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    const tokens = await service.refreshTokens(REFRESH_TOKEN);

    expect(tokens.accessToken).toBe('signed-token');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('user-1');
    expect(message).toContain('db hiccup');
    expect(message).not.toContain(REFRESH_TOKEN);
    expect(message).not.toContain('signed-token');
  });

  it('does not warn when the lastSeenAt update succeeds', async () => {
    const { service } = buildService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await service.refreshTokens(REFRESH_TOKEN);

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not throw and still returns tokens if the lastSeenAt update fails (non-critical, best-effort)', async () => {
    const failingUpdate = jest.fn()
      // First call is updateRefreshToken's own hashed-token write -- let it
      // succeed; the lastSeenAt write (second call) is the one that fails.
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db hiccup'));
    const { service } = buildService({ userUpdate: failingUpdate });

    const tokens = await service.refreshTokens(REFRESH_TOKEN);

    expect(tokens.accessToken).toBe('signed-token');
    expect(tokens.refreshToken).toBe('signed-token');
  });

  it('never updates lastSeenAt if the refresh token itself is invalid (wrong hash)', async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'a@b.com', tenantId: 't1', role: 'AGENT', refreshToken: await bcrypt.hash('a-different-token', 4),
    });

    await expect(service.refreshTokens(REFRESH_TOKEN)).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
