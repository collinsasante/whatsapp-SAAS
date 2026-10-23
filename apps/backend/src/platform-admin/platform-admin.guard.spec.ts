import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PrismaService } from '../prisma/prisma.service';

type Req = Record<string, unknown> & { adminId?: string; adminRole?: string };

function mockContext(headers: Record<string, string>): { ctx: ExecutionContext; request: Req } {
  const request: Req = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('PlatformAdminGuard', () => {
  const jwtService = { verify: jest.fn() } as unknown as JwtService;
  const config = { get: jest.fn().mockReturnValue('test-secret') } as unknown as ConfigService;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { platformAdmin: { findUnique: jest.Mock } };
  let guard: PlatformAdminGuard;
  const bearer = { authorization: 'Bearer admin-token' };
  const token = (claims: Record<string, unknown>) => (jwtService.verify as jest.Mock).mockReturnValue(claims);
  const adminInDb = (row: { isActive: boolean; role: string } | null) => prisma.platformAdmin.findUnique.mockResolvedValue(row);

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    prisma = { platformAdmin: { findUnique: jest.fn().mockResolvedValue({ isActive: true, role: 'VIEWER' }) } };
    guard = new PlatformAdminGuard(jwtService, config, reflector as unknown as Reflector, prisma as unknown as PrismaService);
  });

  it('throws 401 when no Authorization header is present', async () => {
    await expect(guard.canActivate(mockContext({}).ctx)).rejects.toThrow(UnauthorizedException);
    expect(prisma.platformAdmin.findUnique).not.toHaveBeenCalled();
  });

  it('throws 401 when the token fails verification', async () => {
    (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error('bad token'); });
    await expect(guard.canActivate(mockContext({ authorization: 'Bearer bad' }).ctx)).rejects.toThrow(UnauthorizedException);
    expect(prisma.platformAdmin.findUnique).not.toHaveBeenCalled();
  });

  it('throws 403 for a validly-signed token that is not a platform-admin token', async () => {
    token({ sub: 'u1', role: 'ADMIN' });
    await expect(guard.canActivate(mockContext({ authorization: 'Bearer tenant-token' }).ctx)).rejects.toThrow(ForbiddenException);
    expect(prisma.platformAdmin.findUnique).not.toHaveBeenCalled();
  });

  it('allows a platform admin through when the route has no role restriction', async () => {
    token({ sub: 'a1', role: 'platform_admin', adminRole: 'VIEWER' });
    const { ctx, request } = mockContext(bearer);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.platformAdmin.findUnique).toHaveBeenCalledWith({ where: { id: 'a1' }, select: { isActive: true, role: true } });
    expect(request).toMatchObject({ adminId: 'a1', adminRole: 'VIEWER' });
  });

  it('throws 403 when the route requires a role the admin does not have', async () => {
    token({ sub: 'a1', role: 'platform_admin', adminRole: 'VIEWER' });
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN']);
    await expect(guard.canActivate(mockContext(bearer).ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows the admin through when their role is in the required list', async () => {
    token({ sub: 'a1', role: 'platform_admin', adminRole: 'SUPPORT' });
    adminInDb({ isActive: true, role: 'SUPPORT' });
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN', 'SUPPORT']);
    await expect(guard.canActivate(mockContext(bearer).ctx)).resolves.toBe(true);
  });

  it('rejects a correctly signed admin token whose admin does not exist in this database', async () => {
    token({ sub: 'someone-from-another-environment', role: 'platform_admin', adminRole: 'SUPER_ADMIN' });
    adminInDb(null);
    await expect(guard.canActivate(mockContext(bearer).ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token for an admin who has been switched off, even though the token has not expired', async () => {
    token({ sub: 'a1', role: 'platform_admin', adminRole: 'SUPER_ADMIN' });
    adminInDb({ isActive: false, role: 'SUPER_ADMIN' });
    await expect(guard.canActivate(mockContext(bearer).ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('uses the role stored in the database, not the one claimed by the token, so a demotion applies immediately', async () => {
    token({ sub: 'a1', role: 'platform_admin', adminRole: 'SUPER_ADMIN' });
    adminInDb({ isActive: true, role: 'VIEWER' });
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN']);
    await expect(guard.canActivate(mockContext(bearer).ctx)).rejects.toThrow(ForbiddenException);
  });

  it('does not let a token raise its own role above what the database says', async () => {
    token({ sub: 'a1', role: 'platform_admin', adminRole: 'SUPER_ADMIN' });
    adminInDb({ isActive: true, role: 'SUPPORT' });
    const { ctx, request } = mockContext(bearer);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.adminRole).toBe('SUPPORT');
  });

  it('treats an unrecognised stored role as VIEWER (least privilege)', async () => {
    token({ sub: 'a1', role: 'platform_admin' });
    adminInDb({ isActive: true, role: 'SOMETHING_ELSE' });
    reflector.getAllAndOverride.mockReturnValue(['SUPER_ADMIN']);
    await expect(guard.canActivate(mockContext(bearer).ctx)).rejects.toThrow(ForbiddenException);
  });

  it('denies the request when the database cannot be read', async () => {
    token({ sub: 'a1', role: 'platform_admin', adminRole: 'SUPER_ADMIN' });
    prisma.platformAdmin.findUnique.mockRejectedValue(new Error('db down'));
    await expect(guard.canActivate(mockContext(bearer).ctx)).rejects.toThrow();
  });
});
