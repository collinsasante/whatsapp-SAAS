import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PlatformAdminGuard } from './platform-admin.guard';

function mockContext(headers: Record<string, string>): ExecutionContext {
  const request = { headers } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PlatformAdminGuard', () => {
  const jwtService = { verify: jest.fn() } as unknown as JwtService;
  const config = { get: jest.fn().mockReturnValue('test-secret') } as unknown as ConfigService;
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: PlatformAdminGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    guard = new PlatformAdminGuard(jwtService, config, reflector as unknown as Reflector);
  });

  it('throws 401 when no Authorization header is present', () => {
    expect(() => guard.canActivate(mockContext({}))).toThrow(UnauthorizedException);
  });

  it('throws 401 when the token fails verification', () => {
    (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error('bad token'); });
    expect(() => guard.canActivate(mockContext({ authorization: 'Bearer bad' }))).toThrow(UnauthorizedException);
  });

  it('throws 403 for a validly-signed token that is not a platform-admin token', () => {
    (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'u1', role: 'ADMIN' });
    expect(() => guard.canActivate(mockContext({ authorization: 'Bearer tenant-token' }))).toThrow(ForbiddenException);
  });

  it('allows a platform admin through when the route has no role restriction', () => {
    (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'a1', role: 'platform_admin', adminRole: 'VIEWER' });
    expect(guard.canActivate(mockContext({ authorization: 'Bearer admin-token' }))).toBe(true);
  });

  it('throws 403 when the route requires a role the admin does not have', () => {
    (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'a1', role: 'platform_admin', adminRole: 'VIEWER' });
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN']);
    expect(() => guard.canActivate(mockContext({ authorization: 'Bearer admin-token' }))).toThrow(ForbiddenException);
  });

  it('allows the admin through when their role is in the required list', () => {
    (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'a1', role: 'platform_admin', adminRole: 'SUPPORT' });
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN', 'SUPPORT']);
    expect(guard.canActivate(mockContext({ authorization: 'Bearer admin-token' }))).toBe(true);
  });

  it('defaults a token with no adminRole claim to VIEWER (least privilege)', () => {
    (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'a1', role: 'platform_admin' });
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN']);
    expect(() => guard.canActivate(mockContext({ authorization: 'Bearer admin-token' }))).toThrow(ForbiddenException);
  });
});
